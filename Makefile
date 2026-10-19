ENV ?= local
CLUSTER := urumi
# Optional, gitignored file with the LLM key and upstream credentials.
GATEWAY_SECRETS := $(wildcard charts/gateway/secrets.local.yaml)

.PHONY: up cluster cluster-down images image-% store everything gateway store-password admin-password status down

up: images store everything gateway   ## Build everything and install all three releases
	@echo; echo "Store:     http://store.localtest.me"; echo "Dashboard: http://dash.localtest.me  (admin@urumi.local / $$(make -s admin-password))"

cluster:            ## Create the local k3d cluster
	k3d cluster create --config k3d/cluster.yaml

cluster-down:       ## Delete the local k3d cluster (and all its data)
	k3d cluster delete $(CLUSTER)

# Build an image and load it straight into k3d (no registry needed locally).
image-%:
	docker build -t $*:dev $(if $(filter dashboard,$*),dashboard,services/$*)
	k3d image import $*:dev -c $(CLUSTER)

images: image-woo-mcp image-gateway image-everything image-dashboard

store:              ## WordPress + WooCommerce + MariaDB + woo-mcp, in namespace "store"
	helm upgrade --install store charts/store -n store --create-namespace \
	  -f charts/store/values-$(ENV).yaml --wait --timeout 15m
	-kubectl rollout restart deploy/store-woo-mcp -n store

everything:         ## The MCP reference server, in namespace "mcp"
	helm upgrade --install everything charts/everything -n mcp --create-namespace --wait
	-kubectl rollout restart deploy/everything -n mcp

gateway:            ## Gateway + Postgres + dashboard, in namespace "gateway"
	helm upgrade --install gateway charts/gateway -n gateway --create-namespace \
	  -f charts/gateway/values-$(ENV).yaml $(if $(GATEWAY_SECRETS),-f $(GATEWAY_SECRETS)) --wait --timeout 5m
	-kubectl rollout restart deploy/gateway deploy/dashboard -n gateway

store-password:     ## WordPress admin password
	@kubectl get secret store-secrets -n store -o jsonpath='{.data.wp-admin-password}' | base64 -d; echo

admin-password:     ## Dashboard admin password
	@kubectl get secret gateway-secrets -n gateway -o jsonpath='{.data.admin-password}' | base64 -d; echo

status:
	kubectl get pods,svc,ingress,pvc,networkpolicy -n store
	kubectl get pods,svc,networkpolicy -n mcp
	kubectl get pods,svc,ingress,pvc,networkpolicy -n gateway

down:               ## Uninstall all releases (volumes and Secrets are kept)
	-helm uninstall gateway -n gateway
	-helm uninstall everything -n mcp
	-helm uninstall store -n store

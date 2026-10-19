ENV ?= local
CLUSTER := urumi

.PHONY: cluster cluster-down woo-mcp-image store store-down store-password status

cluster:            ## Create the local k3d cluster
	k3d cluster create --config k3d/cluster.yaml

cluster-down:       ## Delete the local k3d cluster (and all its data)
	k3d cluster delete $(CLUSTER)

woo-mcp-image:      ## Build woo-mcp and load it into the k3d cluster (no registry needed locally)
	docker build -t woo-mcp:dev services/woo-mcp
	k3d image import woo-mcp:dev -c $(CLUSTER)
	-kubectl rollout restart deploy/store-woo-mcp -n store

store:              ## Install/upgrade the WooCommerce store (+ its woo-mcp server)
	helm upgrade --install store charts/store \
	  --namespace store --create-namespace \
	  -f charts/store/values-$(ENV).yaml \
	  --wait --timeout 15m

store-down:
	helm uninstall store --namespace store

store-password:     ## Print the WordPress admin password
	@kubectl get secret store-secrets -n store -o jsonpath='{.data.wp-admin-password}' | base64 -d; echo

status:
	kubectl get pods,svc,ingress,pvc -A -l app.kubernetes.io/part-of=urumi

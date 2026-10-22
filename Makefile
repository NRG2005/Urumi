ENV ?= local
CLUSTER := urumi
# Optional, gitignored file with the LLM key and upstream credentials.
GATEWAY_SECRETS := $(wildcard charts/gateway/secrets.local.yaml)

.PHONY: up cluster cluster-down images image-% store everything gateway store-password admin-password status down test-dod evil rugpull evil-down store-backup vps-tunnel vps-kubeconfig vps-up vps-test

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
	helm upgrade --install everything charts/everything -n mcp --create-namespace -f charts/everything/values-$(ENV).yaml --wait
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

test-dod:           ## Check every Definition-of-Done item against the live cluster (ARGS=--skip-llm to skip the chat agent)
	@test -d .venv-test || (python3 -m venv .venv-test && .venv-test/bin/pip install -q mcp==2.3.0)
	.venv-test/bin/python scripts/test_dod.py $(ARGS)

evil:               ## DEMO ONLY: deploy the malicious MCP server (add it in the dashboard: http://evil-mcp.mcp.svc.cluster.local:8000/mcp)
	$(MAKE) image-evil-mcp
	helm upgrade --install evil-mcp charts/evil-mcp -n mcp --create-namespace --wait
	-kubectl rollout restart deploy/evil-mcp -n mcp

rugpull:            ## DEMO ONLY: make the evil server rewrite its tool description
	kubectl exec -n mcp deploy/evil-mcp -- python -c "import urllib.request as u; print(u.urlopen(u.Request('http://127.0.0.1:8000/rugpull', method='POST')).read().decode())"

evil-down:
	-helm uninstall evil-mcp -n mcp

store-backup:       ## Dump the store database to backups/ (do this before upgrading: helm rollback does not roll back data)
	@mkdir -p backups
	kubectl exec -n store store-mariadb-0 -- sh -c 'mariadb-dump -uroot -p"$$MARIADB_ROOT_PASSWORD" --single-transaction wordpress' > backups/store-$$(date +%Y%m%d-%H%M%S).sql
	@ls -lh backups | tail -1

# ---- VPS (k3s) ----------------------------------------------------------------
VPS_IP ?= 4.194.18.91
VPS_KEY ?= ~/.ssh/urumi-key.pem
VPS_USER ?= azureuser

vps-tunnel:         ## Open an SSH tunnel to the VPS's Kubernetes API (port 6443 stays closed to the internet)
	ssh -i $(VPS_KEY) -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -f -N -L 16443:127.0.0.1:6443 $(VPS_USER)@$(VPS_IP)
	@echo "now: export KUBECONFIG=~/.kube/urumi-vps.yaml"

vps-kubeconfig:     ## Fetch the VPS kubeconfig (points at the tunnel) into ~/.kube/urumi-vps.yaml
	ssh -i $(VPS_KEY) $(VPS_USER)@$(VPS_IP) 'sudo cat /etc/rancher/k3s/k3s.yaml' | sed 's#https://127.0.0.1:6443#https://127.0.0.1:16443#; s/: default$$/: urumi-vps/' > ~/.kube/urumi-vps.yaml
	chmod 600 ~/.kube/urumi-vps.yaml

vps-up:             ## Deploy everything to the VPS (needs vps-tunnel; uses values-prod.yaml)
	KUBECONFIG=~/.kube/urumi-vps.yaml $(MAKE) store everything gateway ENV=prod

vps-test:           ## Run the Definition-of-Done check against the VPS
	KUBECONFIG=~/.kube/urumi-vps.yaml URUMI_STORE_URL=https://store.$(VPS_IP).sslip.io URUMI_DASH_URL=https://dash.$(VPS_IP).sslip.io $(MAKE) test-dod

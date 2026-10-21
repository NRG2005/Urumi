# Upgrades and rollback with Helm

Each of the three releases (`store`, `everything`, `gateway`) is installed with `helm upgrade --install`, so every deploy is a numbered revision Helm can return to.

```bash
helm list -A
helm history gateway -n gateway
```

## Upgrading each component

| Component | How to upgrade | What happens |
|---|---|---|
| Gateway / dashboard | new image tag in values (or `make image-gateway` locally), then `make gateway` | Rolling update across 2 replicas: a new pod must pass its readiness probe (`/readyz` checks Postgres) before an old one is removed. Schema changes are additive (`CREATE TABLE IF NOT EXISTS`), guarded by a Postgres advisory lock so replicas don't race. |
| woo-mcp | new image tag in `wooMcp.image`, then `make store` | Rolling update; it's stateless. |
| WordPress | new tag in `wordpress.image`, then `make store-backup && make store` | `Recreate` strategy (the volume is ReadWriteOnce), so a short blip. The bootstrap Job re-runs after the upgrade: `wp core update-db` and `wp wc update` migrate the database. |
| WooCommerce plugin | set `bootstrap.woocommerceVersion` (empty = latest at install time) | Installed by the bootstrap Job, followed by its DB migrations. |
| MariaDB / Postgres | new image tag, after a backup | StatefulSet restart on the same volume; only minor versions without a dump/restore. |

## A failed release doesn't take the gateway down (tested)

Simulate a bad deploy, e.g. a typo in the image tag:

```bash
helm upgrade gateway charts/gateway -n gateway -f charts/gateway/values-local.yaml \
  -f charts/gateway/secrets.local.yaml --set gateway.image=gateway:0.2.0-typo --wait --timeout 60s
# Error: UPGRADE FAILED: resource Deployment/gateway/gateway not ready ... context deadline exceeded

kubectl get pods -n gateway -l app.kubernetes.io/name=gateway
# gateway-7bd4d99759-sfhjw   1/1  Running        <- old replicas still serving
# gateway-7bd4d99759-tpwrm   1/1  Running
# gateway-cbdbf6b8c-t8w8j    0/1  ErrImagePull   <- new replica never became ready

helm history gateway -n gateway        # revision 5: failed
helm rollback gateway 4 -n gateway --wait
# Rollback was a success!               # revision 6: "Rollback to 4"
```

During this whole sequence a probe hitting `http://dash.localtest.me/readyz` every 0.5 s returned **123/123 × HTTP 200**. With 2 replicas, the default rolling update allows 0 unavailable and 1 extra pod, so the broken pod is only ever *added*; the healthy ones are never removed.

To roll back automatically, use Helm 4's `--rollback-on-failure`:

```bash
helm upgrade gateway charts/gateway -n gateway ... --rollback-on-failure --timeout 2m
```

## What rollback does *not* do

`helm rollback` restores Kubernetes objects (Deployments, ConfigMaps, Secrets, …) to an earlier revision. It does **not** restore data in volumes. After a WordPress/WooCommerce upgrade has migrated the database, rolling back the image gives you old code on a new schema. So:

```bash
make store-backup                 # mariadb-dump to backups/store-<timestamp>.sql
make store                        # upgrade
# if it goes wrong: helm rollback store <rev> -n store, then restore the dump:
kubectl exec -i -n store store-mariadb-0 -- sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" wordpress' < backups/store-<timestamp>.sql
```

Pin image tags (CI pushes a commit-SHA tag for every build) rather than `latest` for real upgrades, so each Helm revision refers to an exact build and a rollback returns to it.

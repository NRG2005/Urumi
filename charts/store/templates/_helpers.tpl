{{- define "store.labels" -}}
app.kubernetes.io/part-of: urumi
app.kubernetes.io/instance: {{ .Release.Name }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "store.url" -}}
{{ .Values.store.scheme }}://{{ .Values.store.domain }}
{{- end -}}

{{/* Env vars the official WordPress image reads to generate wp-config.php.
     Shared by the WordPress pod and the bootstrap Job so both see the same config. */}}
{{- define "store.wpEnv" -}}
- name: WORDPRESS_DB_HOST
  value: {{ .Release.Name }}-mariadb
- name: WORDPRESS_DB_NAME
  value: {{ .Values.mariadb.database }}
- name: WORDPRESS_DB_USER
  value: {{ .Values.mariadb.user }}
- name: WORDPRESS_DB_PASSWORD
  valueFrom:
    secretKeyRef: { name: {{ .Release.Name }}-secrets, key: mariadb-password }
# WordPress stores its URL in the DB; pinning it here stops redirects to the wrong host.
- name: WORDPRESS_CONFIG_EXTRA
  value: |
    define('WP_HOME', '{{ include "store.url" . }}');
    define('WP_SITEURL', '{{ include "store.url" . }}');
{{- end -}}

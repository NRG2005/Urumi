{{- define "gw.labels" -}}
app.kubernetes.io/part-of: urumi
app.kubernetes.io/instance: {{ .Release.Name }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "gw.url" -}}
{{ .Values.scheme }}://{{ .Values.domain }}
{{- end -}}

{{/* Keep an existing Secret value on upgrade; otherwise use the provided value or generate one. */}}
{{- define "gw.secretValue" -}}
{{- $old := index . 0 -}}{{- $key := index . 1 -}}{{- $provided := index . 2 -}}{{- $generate := index . 3 -}}
{{- if $provided -}}{{ $provided | b64enc }}
{{- else if hasKey $old $key -}}{{ get $old $key }}
{{- else if $generate -}}{{ randAlphaNum 32 | b64enc }}
{{- else -}}{{ "" | b64enc }}
{{- end -}}
{{- end -}}

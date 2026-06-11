{{/* Common name helpers */}}

{{- define "workflow-engine.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "workflow-engine.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "workflow-engine.labels" -}}
app.kubernetes.io/name: {{ include "workflow-engine.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{- define "workflow-engine.selectorLabels" -}}
app.kubernetes.io/name: {{ include "workflow-engine.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "workflow-engine.postgresFullname" -}}
{{ include "workflow-engine.fullname" . }}-postgres
{{- end -}}

{{- define "workflow-engine.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "workflow-engine.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Resolve the Postgres password.
- If values.postgres.password is set, use it.
- Otherwise, reuse the value already stored in the existing Secret (so upgrades
  don't rotate it), or generate a new random one on first install.
*/}}
{{- define "workflow-engine.postgresPassword" -}}
{{- if .Values.postgres.password -}}
{{- .Values.postgres.password -}}
{{- else -}}
{{- $secretName := printf "%s-db" (include "workflow-engine.fullname" .) -}}
{{- $existing := lookup "v1" "Secret" .Release.Namespace $secretName -}}
{{- if and $existing $existing.data $existing.data.password -}}
{{- index $existing.data "password" | b64dec -}}
{{- else -}}
{{- randAlphaNum 24 -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "workflow-engine.databaseUrl" -}}
{{- $pw := include "workflow-engine.postgresPassword" . -}}
{{- $host := include "workflow-engine.postgresFullname" . -}}
postgres://{{ .Values.postgres.username }}:{{ $pw }}@{{ $host }}:{{ .Values.postgres.port }}/{{ .Values.postgres.database }}
{{- end -}}

{{/*
Render the Ingress host:
- If values.ingress.host is explicitly set, use it.
- Else if loadBalancerIP is set, render workflow.<ip-with-dashes>.nip.io.
- Else render empty string (Ingress will only match the default backend).
*/}}
{{- define "workflow-engine.ingressHost" -}}
{{- if .Values.ingress.host -}}
{{- .Values.ingress.host -}}
{{- else if .Values.ingress.loadBalancerIP -}}
{{- $ipDashed := replace "." "-" .Values.ingress.loadBalancerIP -}}
workflow.{{ $ipDashed }}.nip.io
{{- end -}}
{{- end -}}

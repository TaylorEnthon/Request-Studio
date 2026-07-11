# Data model

Schema version 1 contains `workspaces`, `collections`, `environments`, `environment_variables`, `saved_requests`, `app_settings`, and `schema_migrations`. Collections and environments belong to a workspace; variables belong to an environment; requests belong to a workspace and collection. Foreign keys cascade deletions. Stable request fields use columns; Milestone 2 will model request configuration from real behavior rather than a catch-all JSON field.

Per-workspace environment selection uses `app_settings` keys shaped as `selectedEnvironment:<workspaceId>`; this avoids a schema migration and safely tolerates deleted environments.

Schema version 2 adds `params_json`, `headers_json`, `auth_json`, `body_json`, and `settings_json` to saved requests plus `request_history`. JSON columns are individually Zod-validated. History cascades with Workspace deletion and uses `ON DELETE SET NULL` for Saved Request deletion.

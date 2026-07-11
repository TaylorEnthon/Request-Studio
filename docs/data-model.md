# Data model

Schema version 1 contains `workspaces`, `collections`, `environments`, `environment_variables`, `saved_requests`, `app_settings`, and `schema_migrations`. Collections and environments belong to a workspace; variables belong to an environment; requests belong to a workspace and collection. Foreign keys cascade deletions. Stable request fields use columns; Milestone 2 will model request configuration from real behavior rather than a catch-all JSON field.

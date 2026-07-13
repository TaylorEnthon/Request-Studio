import Database from 'better-sqlite3'

const schema = `
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,name TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS environments(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,name TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS environment_variables(id TEXT PRIMARY KEY,environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,key TEXT NOT NULL,value TEXT NOT NULL,is_secret INTEGER NOT NULL DEFAULT 0,description TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(environment_id,key));
CREATE TABLE IF NOT EXISTS saved_requests(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,name TEXT NOT NULL,protocol TEXT NOT NULL CHECK(protocol IN ('http','websocket','sse')),method TEXT,url TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);`

const schemaV2 = `
ALTER TABLE saved_requests ADD COLUMN params_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE saved_requests ADD COLUMN headers_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE saved_requests ADD COLUMN auth_json TEXT NOT NULL DEFAULT '{"type":"none"}';
ALTER TABLE saved_requests ADD COLUMN body_json TEXT NOT NULL DEFAULT '{"type":"none"}';
ALTER TABLE saved_requests ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{"timeoutMs":30000}';
CREATE TABLE request_history(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,saved_request_id TEXT REFERENCES saved_requests(id) ON DELETE SET NULL,request_name TEXT NOT NULL,method TEXT NOT NULL,url_template TEXT NOT NULL,resolved_url_redacted TEXT NOT NULL,started_at TEXT NOT NULL,completed_at TEXT,duration_ms INTEGER,status_code INTEGER,status_text TEXT,request_snapshot_json TEXT NOT NULL,response_headers_json TEXT NOT NULL DEFAULT '{}',response_body_kind TEXT,response_body_text TEXT,response_file_path TEXT,response_size_bytes INTEGER NOT NULL DEFAULT 0,content_type TEXT,error_json TEXT,was_cancelled INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE INDEX request_history_workspace_created_idx ON request_history(workspace_id,created_at DESC);`
const schemaV3 = `CREATE TABLE response_resources(id TEXT PRIMARY KEY,history_id TEXT NOT NULL REFERENCES request_history(id) ON DELETE CASCADE,source TEXT NOT NULL,kind TEXT NOT NULL,declared_mime_type TEXT,detected_mime_type TEXT,effective_mime_type TEXT,path TEXT NOT NULL,byte_length INTEGER NOT NULL,suggested_filename TEXT NOT NULL,warnings_json TEXT NOT NULL DEFAULT '[]',digest TEXT,created_at TEXT NOT NULL,UNIQUE(history_id,source,digest));CREATE INDEX response_resources_history_idx ON response_resources(history_id);`
const schemaV4 = `
ALTER TABLE saved_requests ADD COLUMN stream_config_json TEXT NOT NULL DEFAULT '{}';
CREATE TABLE stream_sessions(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,saved_request_id TEXT REFERENCES saved_requests(id) ON DELETE SET NULL,protocol TEXT NOT NULL CHECK(protocol IN ('websocket','sse')),request_name TEXT NOT NULL,status TEXT NOT NULL,started_at TEXT NOT NULL,connected_at TEXT,first_record_at TEXT,ended_at TEXT,duration_ms INTEGER,close_code INTEGER,close_reason_redacted TEXT,error_json TEXT,inbound_count INTEGER NOT NULL DEFAULT 0,outbound_count INTEGER NOT NULL DEFAULT 0,event_count INTEGER NOT NULL DEFAULT 0,inbound_bytes INTEGER NOT NULL DEFAULT 0,outbound_bytes INTEGER NOT NULL DEFAULT 0,reconnect_count INTEGER NOT NULL DEFAULT 0,request_snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX stream_sessions_workspace_created_idx ON stream_sessions(workspace_id,created_at DESC);
CREATE TABLE stream_records(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES stream_sessions(id) ON DELETE CASCADE,sequence INTEGER NOT NULL,direction TEXT NOT NULL,record_type TEXT NOT NULL,data_kind TEXT NOT NULL,timestamp INTEGER NOT NULL,byte_length INTEGER NOT NULL,text_preview TEXT,json_text TEXT,resource_id TEXT,event_name TEXT,event_id TEXT,retry_ms INTEGER,outcome TEXT,metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,UNIQUE(session_id,sequence));
CREATE INDEX stream_records_session_sequence_idx ON stream_records(session_id,sequence);
CREATE TABLE stream_message_templates(id TEXT PRIMARY KEY,saved_request_id TEXT NOT NULL REFERENCES saved_requests(id) ON DELETE CASCADE,name TEXT NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE stream_resources(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES stream_sessions(id) ON DELETE CASCADE,record_id TEXT REFERENCES stream_records(id) ON DELETE CASCADE,kind TEXT NOT NULL,mime_type TEXT,path TEXT NOT NULL,byte_length INTEGER NOT NULL,suggested_filename TEXT NOT NULL,warnings_json TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL);
CREATE INDEX stream_resources_session_idx ON stream_resources(session_id);`

export function createDatabase(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('foreign_keys = ON')
  if (Number(db.pragma('user_version', { simple: true })) < 1)
    db.transaction(() => {
      db.exec(schema)
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(1,?)').run(new Date().toISOString())
      db.pragma('user_version = 1')
    })()
  if (Number(db.pragma('user_version', { simple: true })) < 2)
    db.transaction(() => {
      db.exec(schemaV2)
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(2,?)').run(new Date().toISOString())
      db.pragma('user_version = 2')
    })()
  if (Number(db.pragma('user_version', { simple: true })) < 3)
    db.transaction(() => {
      db.exec(schemaV3)
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(3,?)').run(new Date().toISOString())
      db.pragma('user_version = 3')
    })()
  if (Number(db.pragma('user_version', { simple: true })) < 4)
    db.transaction(() => {
      db.exec(schemaV4)
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(4,?)').run(new Date().toISOString())
      db.pragma('user_version = 4')
    })()
  return db
}

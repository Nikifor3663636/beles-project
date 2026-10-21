CREATE TABLE IF NOT EXISTS beles_schema_versions (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS beles_documents (name text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS beles_brands (item_key text PRIMARY KEY, name text NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS beles_catalog (
  record_id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('brand','product','partner','presentation','content')),
  item_key text NOT NULL,
  position integer NOT NULL,
  brand_key text REFERENCES beles_brands(item_key) ON UPDATE CASCADE,
  payload jsonb NOT NULL
);
-- Legacy imports may contain duplicate business keys. Preserve every occurrence;
-- new writes are checked by the catalogue validator instead of silently dropping rows.
CREATE INDEX IF NOT EXISTS beles_catalog_business_key ON beles_catalog(kind, item_key);
CREATE INDEX IF NOT EXISTS beles_catalog_kind_position ON beles_catalog(kind, position);
CREATE INDEX IF NOT EXISTS beles_catalog_brand ON beles_catalog(brand_key);
CREATE TABLE IF NOT EXISTS beles_users (
  id text PRIMARY KEY,
  username text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','admin')),
  enabled boolean NOT NULL DEFAULT true,
  payload jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS beles_users_username_ci ON beles_users(lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS beles_single_owner ON beles_users(role) WHERE role = 'owner';
CREATE TABLE IF NOT EXISTS beles_feedback (id text PRIMARY KEY, created_at timestamptz NOT NULL, position integer NOT NULL, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS beles_media (key text PRIMARY KEY, sha256 text, bytes bigint NOT NULL CHECK(bytes >= 0), payload jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS beles_media_hash ON beles_media(sha256);
CREATE TABLE IF NOT EXISTS beles_sessions (id text PRIMARY KEY, user_id text NOT NULL REFERENCES beles_users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, payload jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS beles_sessions_user ON beles_sessions(user_id);
CREATE TABLE IF NOT EXISTS beles_audit (id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS beles_imports (name text PRIMARY KEY, source_hash text NOT NULL, imported_at timestamptz NOT NULL DEFAULT now());
INSERT INTO beles_schema_versions(version) VALUES (1) ON CONFLICT DO NOTHING;

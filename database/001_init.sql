-- Future SQL migration for PostgreSQL/MySQL. The current browser prototype uses localStorage.
CREATE TABLE projects (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  lead_character_json TEXT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE prompt_templates (
  id VARCHAR(64) PRIMARY KEY,
  kind VARCHAR(32) NOT NULL CHECK (kind IN ('image_prompt', 'video_prompt')),
  name VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE shot_blocks (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 10 CHECK (duration_seconds = 10),
  title VARCHAR(300) NOT NULL,
  movement TEXT NOT NULL,
  prompt TEXT NOT NULL,
  transition TEXT NOT NULL,
  incoming_anchor TEXT NULL,
  outgoing_anchor TEXT NULL,
  audit TEXT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE(project_id, sequence_no)
);

CREATE INDEX idx_prompt_templates_kind ON prompt_templates(kind);
CREATE INDEX idx_shot_blocks_project ON shot_blocks(project_id, sequence_no);

CREATE TABLE users (
  id                   TEXT PRIMARY KEY CHECK (length(id) = 26),
  email                TEXT NOT NULL UNIQUE
                       CHECK (email = lower(trim(email)) AND email LIKE '%_@_%._%'),
  full_name            TEXT NOT NULL CHECK (length(trim(full_name)) BETWEEN 1 AND 120),
  display_name         TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 60),
  department           TEXT CHECK (department IS NULL OR length(trim(department)) BETWEEN 1 AND 80),
  role                 TEXT NOT NULL
                       CHECK (role IN ('employee','manager','approver','owner')),
  is_admin             INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0,1)),
  can_upload_invoices  INTEGER NOT NULL DEFAULT 0 CHECK (can_upload_invoices IN (0,1)),
  can_manage_jobs      INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_jobs IN (0,1)),
  can_login            INTEGER NOT NULL DEFAULT 1 CHECK (can_login IN (0,1)),
  avatar_hue           INTEGER CHECK (avatar_hue BETWEEN 0 AND 359),
  locale               TEXT CHECK (locale IS NULL OR length(locale) BETWEEN 2 AND 10),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','inactive')),
  password_hash        TEXT CHECK (password_hash IS NULL OR length(password_hash) BETWEEN 20 AND 200),
  email_verified_at    TEXT CHECK (email_verified_at IS NULL OR email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', email_verified_at)),
  password_changed_at  TEXT CHECK (password_changed_at IS NULL OR password_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ', password_changed_at)),
  deactivated_at       TEXT CHECK (deactivated_at = strftime('%Y-%m-%dT%H:%M:%fZ', deactivated_at)),
  deactivated_by       TEXT REFERENCES users(id),
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                       CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  created_by           TEXT REFERENCES users(id),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                       CHECK (updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)),
  updated_by           TEXT REFERENCES users(id),
  version              INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK ((status = 'inactive') = (deactivated_at IS NOT NULL))
) STRICT;
CREATE TABLE leave_entitlements (
  id                TEXT PRIMARY KEY CHECK (length(id) = 26),
  user_id           TEXT NOT NULL REFERENCES users(id),
  year              INTEGER NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  entitled_days     INTEGER NOT NULL CHECK (entitled_days BETWEEN 0 AND 60),
  used_before_days  INTEGER NOT NULL DEFAULT 0 CHECK (used_before_days >= 0),
  note              TEXT CHECK (length(note) <= 500),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                    CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  created_by        TEXT NOT NULL REFERENCES users(id),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                    CHECK (updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)),
  updated_by        TEXT NOT NULL REFERENCES users(id),
  version           INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (user_id, year),
  CHECK (used_before_days <= entitled_days)
) STRICT;
CREATE TABLE requests (
  id               TEXT PRIMARY KEY CHECK (length(id) = 26),
  type             TEXT NOT NULL CHECK (type IN ('leave','expense','advance','purchase','travel')),
  requester_id     TEXT NOT NULL REFERENCES users(id),
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','pending','approved','rejected','paid','cancelled')),
  title            TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  note             TEXT CHECK (length(note) <= 2000),
  project          TEXT CHECK (length(project) <= 120),
  total_base_minor  INTEGER CHECK (total_base_minor >= 0),
  submitted_at     TEXT CHECK (submitted_at = strftime('%Y-%m-%dT%H:%M:%fZ', submitted_at)),
  decided_at       TEXT CHECK (decided_at = strftime('%Y-%m-%dT%H:%M:%fZ', decided_at)),
  decided_by       TEXT REFERENCES users(id),
  decision_note    TEXT CHECK (length(decision_note) <= 1000),
  auto_approved    INTEGER NOT NULL DEFAULT 0 CHECK (auto_approved IN (0,1)),
  paid_at          TEXT CHECK (paid_at = strftime('%Y-%m-%dT%H:%M:%fZ', paid_at)),
  paid_by          TEXT REFERENCES users(id),
  cancelled_at     TEXT CHECK (cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', cancelled_at)),
  cancelled_by     TEXT REFERENCES users(id),
  cancel_reason    TEXT CHECK (length(cancel_reason) <= 1000),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                   CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  created_by       TEXT NOT NULL REFERENCES users(id),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                   CHECK (updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)),
  updated_by       TEXT NOT NULL REFERENCES users(id),
  version          INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1), approver_role TEXT CHECK (approver_role IS NULL OR approver_role IN ('manager','approver','owner')),

  UNIQUE (id, type),
  CHECK (type <> 'leave' OR total_base_minor IS NULL),
  CHECK (status <> 'paid' OR type IN ('expense','advance')),
  CHECK (status IN ('draft','cancelled') OR submitted_at IS NOT NULL),
  CHECK (status NOT IN ('approved','rejected','paid') OR (decided_at IS NOT NULL AND decided_by IS NOT NULL)),
  CHECK (status <> 'rejected' OR length(trim(decision_note)) > 0),
  CHECK (status <> 'paid' OR (paid_at IS NOT NULL AND paid_by IS NOT NULL)),
  CHECK (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)),
  CHECK (auto_approved = 0 OR decided_by = requester_id),
  CHECK (auto_approved = 1 OR decided_by IS NULL OR decided_by <> requester_id)
) STRICT;
CREATE INDEX ix_requests_requester_created ON requests (requester_id, created_at DESC);
CREATE INDEX ix_requests_requester_type_status ON requests (requester_id, type, status);
CREATE INDEX ix_requests_queue ON requests (status, type, submitted_at);
CREATE TABLE request_items (
  id                TEXT PRIMARY KEY CHECK (length(id) = 26),
  request_id        TEXT NOT NULL,
  type              TEXT NOT NULL DEFAULT 'expense' CHECK (type = 'expense'),
  line_no           INTEGER NOT NULL CHECK (line_no >= 1),
  expense_date      TEXT NOT NULL CHECK (expense_date = date(expense_date)),
  category          TEXT NOT NULL CHECK (category IN ('transport','meals','lodging','equipment_rental','supplies','other')),
  description       TEXT CHECK (length(description) <= 300),
  currency          TEXT NOT NULL DEFAULT 'TRY' CHECK (currency IN ('TRY','USD','EUR')),
  amount_minor      INTEGER NOT NULL CHECK (amount_minor > 0),
  fx_rate_micro     INTEGER NOT NULL DEFAULT 1000000 CHECK (fx_rate_micro > 0),
  amount_base_minor  INTEGER NOT NULL CHECK (amount_base_minor >= 0),
  archived_at       TEXT CHECK (archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', archived_at)),
  archived_by       TEXT REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                    CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  created_by        TEXT NOT NULL REFERENCES users(id),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                    CHECK (updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)),
  updated_by        TEXT NOT NULL REFERENCES users(id),
  version           INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1), doc_no TEXT CHECK (doc_no IS NULL OR length(trim(doc_no)) BETWEEN 1 AND 60), vat_minor INTEGER CHECK (vat_minor IS NULL OR vat_minor >= 0),
  UNIQUE (request_id, line_no),
  CHECK (fx_rate_micro <> 1000000 OR amount_base_minor = amount_minor),
  FOREIGN KEY (request_id, type) REFERENCES requests (id, type)
) STRICT;
CREATE INDEX ix_items_expense_date ON request_items (expense_date) WHERE archived_at IS NULL;
CREATE TABLE travel_requests (
  request_id              TEXT PRIMARY KEY,
  type                    TEXT NOT NULL DEFAULT 'travel' CHECK (type = 'travel'),
  destination             TEXT NOT NULL CHECK (length(trim(destination)) BETWEEN 1 AND 120),
  start_date              TEXT NOT NULL CHECK (start_date = date(start_date)),
  end_date                TEXT NOT NULL CHECK (end_date = date(end_date)),
  purpose                 TEXT NOT NULL CHECK (length(trim(purpose)) BETWEEN 1 AND 500),
  transport               TEXT NOT NULL CHECK (transport IN ('plane','bus','car','train','other')),
  accommodation           TEXT NOT NULL CHECK (accommodation IN ('none','hotel')),
  estimated_budget_minor  INTEGER CHECK (estimated_budget_minor >= 0),
  CHECK (end_date >= start_date),
  FOREIGN KEY (request_id, type) REFERENCES requests (id, type)
) STRICT;
CREATE TABLE advance_requests (
  request_id         TEXT PRIMARY KEY,
  type               TEXT NOT NULL DEFAULT 'advance' CHECK (type = 'advance'),
  amount_minor       INTEGER NOT NULL CHECK (amount_minor > 0),
  needed_on          TEXT NOT NULL CHECK (needed_on = date(needed_on)),
  travel_request_id  TEXT REFERENCES travel_requests (request_id), payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('bank','cash')), iban TEXT CHECK (iban IS NULL OR (length(iban) BETWEEN 15 AND 34 AND iban GLOB '[A-Z][A-Z][0-9][0-9]*' AND iban NOT GLOB '*[^A-Z0-9]*')),
  FOREIGN KEY (request_id, type) REFERENCES requests (id, type)
) STRICT;
CREATE INDEX ix_advance_travel ON advance_requests (travel_request_id) WHERE travel_request_id IS NOT NULL;
CREATE TABLE purchase_requests (
  request_id           TEXT PRIMARY KEY,
  type                 TEXT NOT NULL DEFAULT 'purchase' CHECK (type = 'purchase'),
  category             TEXT NOT NULL CHECK (category IN ('equipment','software','other')),
  item_name            TEXT NOT NULL CHECK (length(trim(item_name)) BETWEEN 1 AND 200),
  quantity             INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 999),
  unit_estimated_minor INTEGER NOT NULL CHECK (unit_estimated_minor >= 0),
  estimated_minor      INTEGER NOT NULL CHECK (estimated_minor >= 0),
  license_period       TEXT CHECK (license_period IN ('monthly','yearly','one_time')),
  url                  TEXT CHECK (url IS NULL OR ((url LIKE 'https://%' OR url LIKE 'http://%') AND length(url) <= 1000)),
  CHECK (estimated_minor = quantity * unit_estimated_minor),
  CHECK (license_period IS NULL OR category = 'software'),
  FOREIGN KEY (request_id, type) REFERENCES requests (id, type)
) STRICT;
CREATE TABLE advance_allocations (
  id                  TEXT PRIMARY KEY CHECK (length(id) = 26),
  advance_request_id  TEXT NOT NULL REFERENCES advance_requests (request_id),
  expense_request_id  TEXT NOT NULL,
  expense_type        TEXT NOT NULL DEFAULT 'expense' CHECK (expense_type = 'expense'),
  amount_minor        INTEGER NOT NULL CHECK (amount_minor > 0),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                      CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  created_by          TEXT NOT NULL REFERENCES users(id),
  UNIQUE (advance_request_id, expense_request_id),
  FOREIGN KEY (expense_request_id, expense_type) REFERENCES requests (id, type)
) STRICT;
CREATE INDEX ix_alloc_expense ON advance_allocations (expense_request_id);
CREATE TABLE audit_log (
  id             TEXT PRIMARY KEY CHECK (length(id) = 26),
  at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                 CHECK (at = strftime('%Y-%m-%dT%H:%M:%fZ', at)),
  actor_user_id  TEXT REFERENCES users(id),
  actor_email    TEXT,
  action         TEXT NOT NULL CHECK (length(action) BETWEEN 3 AND 60),
  entity_type    TEXT NOT NULL CHECK (entity_type IN (
                   'user','leave_entitlement','request','request_item','advance_allocation','attachment',
                   'agreement','invoice','invoice_item','asset','assignment','fixed_cost','auth','export','settings')),
  entity_id      TEXT,
  before_json    TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json     TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  meta_json      TEXT CHECK (meta_json IS NULL OR json_valid(meta_json))
) STRICT;
CREATE INDEX ix_audit_entity ON audit_log (entity_type, entity_id, at);
CREATE INDEX ix_audit_actor ON audit_log (actor_user_id, at);
CREATE INDEX ix_audit_at ON audit_log (at);
CREATE TABLE assertions (code TEXT NOT NULL) STRICT;
CREATE TRIGGER trg_assertions_raise BEFORE INSERT ON assertions
BEGIN SELECT RAISE(ABORT, NEW.code); END;
CREATE TABLE agreements (
  id              TEXT PRIMARY KEY CHECK (length(id) = 26),
  title           TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  counterparty    TEXT NOT NULL CHECK (length(trim(counterparty)) BETWEEN 1 AND 200),
  start_date      TEXT NOT NULL CHECK (start_date = date(start_date)),
  end_date        TEXT CHECK (end_date = date(end_date)),
  currency        TEXT NOT NULL DEFAULT 'TRY' CHECK (currency IN ('TRY','USD','EUR')),
  amount_minor    INTEGER CHECK (amount_minor >= 0),
  amount_period   TEXT CHECK (amount_period IN ('yearly','monthly','one_time')),
  tag             TEXT CHECK (length(tag) <= 60),
  note            TEXT CHECK (length(note) <= 2000),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                  CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  created_by      TEXT NOT NULL REFERENCES users(id),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                  CHECK (updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)),
  updated_by      TEXT NOT NULL REFERENCES users(id),
  version         INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  archived_at     TEXT CHECK (archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', archived_at)),
  archived_by     TEXT REFERENCES users(id),
  archive_reason  TEXT CHECK (length(archive_reason) <= 500),
  CHECK (end_date IS NULL OR end_date >= start_date)
) STRICT;
CREATE INDEX ix_agreements_end ON agreements (end_date) WHERE archived_at IS NULL AND end_date IS NOT NULL;
CREATE TABLE invoices (
  id              TEXT PRIMARY KEY CHECK (length(id) = 26),
  direction       TEXT NOT NULL CHECK (direction IN ('in','out')),
  invoice_no      TEXT NOT NULL CHECK (length(trim(invoice_no)) BETWEEN 1 AND 60),
  counterparty    TEXT NOT NULL CHECK (length(trim(counterparty)) BETWEEN 1 AND 200),
  invoice_date    TEXT NOT NULL CHECK (invoice_date = date(invoice_date)),
  due_on          TEXT CHECK (due_on = date(due_on)),
  currency        TEXT NOT NULL DEFAULT 'TRY' CHECK (currency IN ('TRY','USD','EUR')),
  fx_rate_micro   INTEGER NOT NULL DEFAULT 1000000 CHECK (fx_rate_micro > 0),
  vat_rate_bp     INTEGER CHECK (vat_rate_bp BETWEEN 0 AND 10000),
  net_minor       INTEGER NOT NULL CHECK (net_minor >= 0),
  vat_minor       INTEGER NOT NULL CHECK (vat_minor >= 0),
  net_base_minor   INTEGER NOT NULL CHECK (net_base_minor >= 0),
  vat_base_minor   INTEGER NOT NULL CHECK (vat_base_minor >= 0),
  settled_on      TEXT CHECK (settled_on = date(settled_on)),
  note            TEXT CHECK (length(note) <= 2000),
  uploaded_by     TEXT NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                  CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  created_by      TEXT NOT NULL REFERENCES users(id),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                  CHECK (updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)),
  updated_by      TEXT NOT NULL REFERENCES users(id),
  version         INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  archived_at     TEXT CHECK (archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', archived_at)),
  archived_by     TEXT REFERENCES users(id),
  archive_reason  TEXT CHECK (length(archive_reason) <= 500), cost_kind TEXT CHECK (cost_kind IS NULL OR (cost_kind IN ('direct','overhead') AND direction = 'in')), approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending','approved','rejected')), decided_at TEXT CHECK (decided_at IS NULL OR decided_at = strftime('%Y-%m-%dT%H:%M:%fZ', decided_at)), decided_by TEXT REFERENCES users(id), decision_note TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 1000), auto_approved INTEGER NOT NULL DEFAULT 0 CHECK (auto_approved IN (0,1)),
  CHECK (fx_rate_micro <> 1000000 OR (net_base_minor = net_minor AND vat_base_minor = vat_minor)),
  CHECK (settled_on IS NULL OR settled_on >= invoice_date),
  CHECK (due_on IS NULL OR due_on >= invoice_date)
) STRICT;
CREATE INDEX ix_invoices_dir_date ON invoices (direction, invoice_date) WHERE archived_at IS NULL;
CREATE INDEX ix_invoices_open ON invoices (direction, invoice_date) WHERE archived_at IS NULL AND settled_on IS NULL;
CREATE INDEX ix_invoices_uploader ON invoices (uploaded_by, created_at DESC);
CREATE UNIQUE INDEX ux_invoices_no ON invoices (direction, lower(counterparty), invoice_no) WHERE archived_at IS NULL;
CREATE TABLE invoice_items (
  id               TEXT PRIMARY KEY CHECK (length(id) = 26),
  invoice_id       TEXT NOT NULL REFERENCES invoices(id),
  line_no          INTEGER NOT NULL CHECK (line_no >= 1),
  description      TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 300),
  quantity         INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  serial_no        TEXT CHECK (length(serial_no) <= 100),
  unit_net_minor   INTEGER CHECK (unit_net_minor >= 0),
  line_net_minor   INTEGER CHECK (line_net_minor >= 0),
  vat_rate_bp      INTEGER CHECK (vat_rate_bp BETWEEN 0 AND 10000),
  to_inventory     INTEGER NOT NULL DEFAULT 0 CHECK (to_inventory IN (0,1)),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                   CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  created_by       TEXT NOT NULL REFERENCES users(id),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                   CHECK (updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)),
  updated_by       TEXT NOT NULL REFERENCES users(id),
  version          INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  archived_at      TEXT CHECK (archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', archived_at)),
  archived_by      TEXT REFERENCES users(id),
  UNIQUE (invoice_id, line_no),
  CHECK (serial_no IS NULL OR quantity = 1)
) STRICT;
CREATE TABLE attachments (
  id               TEXT PRIMARY KEY CHECK (length(id) = 26),
  r2_key           TEXT NOT NULL UNIQUE CHECK (r2_key GLOB 'att/[0-9][0-9][0-9][0-9]/[0-9][0-9]/*'),
  kind             TEXT NOT NULL
                   CHECK (kind IN ('receipt','invoice_file','agreement_file','health_report','other')),
  request_id       TEXT REFERENCES requests (id),
  request_item_id  TEXT REFERENCES request_items (id),
  invoice_id       TEXT REFERENCES invoices (id),
  agreement_id     TEXT REFERENCES agreements (id),
  original_name    TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 200),
  content_type     TEXT NOT NULL
                   CHECK (content_type IN ('application/pdf','image/jpeg','image/png','image/heic','image/heif')),
  size_bytes       INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  sha256           TEXT NOT NULL CHECK (length(sha256) = 64),
  is_sensitive     INTEGER NOT NULL DEFAULT 0 CHECK (is_sensitive IN (0,1)),
  uploaded_by      TEXT NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                   CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  archived_at      TEXT CHECK (archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', archived_at)),
  archived_by      TEXT REFERENCES users(id),
  CHECK ((request_id IS NOT NULL) + (request_item_id IS NOT NULL)
       + (invoice_id IS NOT NULL) + (agreement_id IS NOT NULL) = 1),
  CHECK (kind <> 'health_report' OR (is_sensitive = 1 AND request_id IS NOT NULL)),
  CHECK (kind <> 'agreement_file' OR agreement_id IS NOT NULL),
  CHECK (kind <> 'invoice_file' OR invoice_id IS NOT NULL OR request_item_id IS NOT NULL)
) STRICT;
CREATE INDEX ix_att_request   ON attachments (request_id)      WHERE request_id IS NOT NULL;
CREATE INDEX ix_att_item      ON attachments (request_item_id) WHERE request_item_id IS NOT NULL;
CREATE INDEX ix_att_invoice   ON attachments (invoice_id)      WHERE invoice_id IS NOT NULL;
CREATE INDEX ix_att_agreement ON attachments (agreement_id)    WHERE agreement_id IS NOT NULL;
CREATE TABLE assets (
  id               TEXT PRIMARY KEY CHECK (length(id) = 26),
  name             TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  category         TEXT CHECK (length(category) <= 60),
  serial_no        TEXT CHECK (length(serial_no) <= 100),
  condition        TEXT NOT NULL DEFAULT 'active'
                   CHECK (condition IN ('active','in_repair','retired')),
  invoice_item_id  TEXT REFERENCES invoice_items(id),
  acquired_on      TEXT CHECK (acquired_on = date(acquired_on)),
  note             TEXT CHECK (length(note) <= 1000),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                   CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  created_by       TEXT NOT NULL REFERENCES users(id),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                   CHECK (updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)),
  updated_by       TEXT NOT NULL REFERENCES users(id),
  version          INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  archived_at      TEXT CHECK (archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', archived_at)),
  archived_by      TEXT REFERENCES users(id)
, quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 9999 AND (quantity = 1 OR serial_no IS NULL)), source TEXT CHECK (length(source) <= 120), holder_other TEXT CHECK (length(holder_other) <= 200), holder_other_on TEXT CHECK (holder_other_on = date(holder_other_on))) STRICT;
CREATE UNIQUE INDEX ux_assets_serial ON assets (lower(serial_no)) WHERE serial_no IS NOT NULL AND archived_at IS NULL;
CREATE INDEX ix_assets_invoice_item ON assets (invoice_item_id) WHERE invoice_item_id IS NOT NULL;
CREATE TABLE assignments (
  id           TEXT PRIMARY KEY CHECK (length(id) = 26),
  asset_id     TEXT NOT NULL REFERENCES assets(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  assigned_on  TEXT NOT NULL CHECK (assigned_on = date(assigned_on)),
  returned_on  TEXT CHECK (returned_on = date(returned_on)),
  note         TEXT CHECK (length(note) <= 500),
  assigned_by  TEXT NOT NULL REFERENCES users(id),
  returned_by  TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               CHECK (updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)),
  updated_by   TEXT NOT NULL REFERENCES users(id),
  version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1), acknowledged_at TEXT CHECK (acknowledged_at = strftime('%Y-%m-%dT%H:%M:%fZ', acknowledged_at)), acknowledged_ip TEXT CHECK (length(acknowledged_ip) <= 64), return_confirmed_at TEXT CHECK (return_confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ', return_confirmed_at)), return_confirmed_ip TEXT CHECK (length(return_confirmed_ip) <= 64), disputed_at TEXT CHECK (disputed_at = strftime('%Y-%m-%dT%H:%M:%fZ', disputed_at)), dispute_note TEXT CHECK (length(dispute_note) <= 300),
  CHECK (returned_on IS NULL OR returned_on >= assigned_on),
  CHECK ((returned_on IS NULL) = (returned_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_assignments_open ON assignments (asset_id) WHERE returned_on IS NULL;
CREATE INDEX ix_assignments_user ON assignments (user_id, returned_on);
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER trg_users_no_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'no delete: deactivate'); END;
CREATE TRIGGER trg_leave_entitlements_no_delete BEFORE DELETE ON leave_entitlements BEGIN SELECT RAISE(ABORT, 'no delete'); END;
CREATE TRIGGER trg_requests_no_delete BEFORE DELETE ON requests BEGIN SELECT RAISE(ABORT, 'no delete: cancel'); END;
CREATE TRIGGER trg_request_items_no_delete BEFORE DELETE ON request_items BEGIN SELECT RAISE(ABORT, 'no delete: archive'); END;
CREATE TRIGGER trg_travel_requests_no_delete BEFORE DELETE ON travel_requests BEGIN SELECT RAISE(ABORT, 'no delete'); END;
CREATE TRIGGER trg_advance_requests_no_delete BEFORE DELETE ON advance_requests BEGIN SELECT RAISE(ABORT, 'no delete'); END;
CREATE TRIGGER trg_purchase_requests_no_delete BEFORE DELETE ON purchase_requests BEGIN SELECT RAISE(ABORT, 'no delete'); END;
CREATE TRIGGER trg_advance_allocations_no_delete BEFORE DELETE ON advance_allocations BEGIN SELECT RAISE(ABORT, 'no delete'); END;
CREATE TRIGGER trg_attachments_no_delete BEFORE DELETE ON attachments BEGIN SELECT RAISE(ABORT, 'no delete: archive'); END;
CREATE TRIGGER trg_agreements_no_delete BEFORE DELETE ON agreements BEGIN SELECT RAISE(ABORT, 'no delete: archive'); END;
CREATE TRIGGER trg_invoices_no_delete BEFORE DELETE ON invoices BEGIN SELECT RAISE(ABORT, 'no delete: archive'); END;
CREATE TRIGGER trg_invoice_items_no_delete BEFORE DELETE ON invoice_items BEGIN SELECT RAISE(ABORT, 'no delete: archive'); END;
CREATE TRIGGER trg_assets_no_delete BEFORE DELETE ON assets BEGIN SELECT RAISE(ABORT, 'no delete: archive'); END;
CREATE TRIGGER trg_assignments_no_delete BEFORE DELETE ON assignments BEGIN SELECT RAISE(ABORT, 'no delete'); END;
CREATE TRIGGER trg_requests_insert_draft BEFORE INSERT ON requests WHEN NEW.status <> 'draft'
BEGIN SELECT RAISE(ABORT, 'request must be created as draft'); END;
CREATE TRIGGER trg_request_items_draft_ins BEFORE INSERT ON request_items WHEN (SELECT status FROM requests WHERE id = NEW.request_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'parent request is not draft'); END;
CREATE TRIGGER trg_request_items_draft_upd BEFORE UPDATE ON request_items WHEN (SELECT status FROM requests WHERE id = OLD.request_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'parent request is not draft'); END;
CREATE TRIGGER trg_travel_requests_draft_ins BEFORE INSERT ON travel_requests WHEN (SELECT status FROM requests WHERE id = NEW.request_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'parent request is not draft'); END;
CREATE TRIGGER trg_travel_requests_draft_upd BEFORE UPDATE ON travel_requests WHEN (SELECT status FROM requests WHERE id = OLD.request_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'parent request is not draft'); END;
CREATE TRIGGER trg_advance_requests_draft_ins BEFORE INSERT ON advance_requests WHEN (SELECT status FROM requests WHERE id = NEW.request_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'parent request is not draft'); END;
CREATE TRIGGER trg_advance_requests_draft_upd BEFORE UPDATE ON advance_requests WHEN (SELECT status FROM requests WHERE id = OLD.request_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'parent request is not draft'); END;
CREATE TRIGGER trg_purchase_requests_draft_ins BEFORE INSERT ON purchase_requests WHEN (SELECT status FROM requests WHERE id = NEW.request_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'parent request is not draft'); END;
CREATE TRIGGER trg_purchase_requests_draft_upd BEFORE UPDATE ON purchase_requests WHEN (SELECT status FROM requests WHERE id = OLD.request_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'parent request is not draft'); END;
CREATE TRIGGER trg_advance_allocations_draft_ins BEFORE INSERT ON advance_allocations WHEN (SELECT status FROM requests WHERE id = NEW.expense_request_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'parent request is not draft'); END;
CREATE TRIGGER trg_advance_allocations_draft_upd BEFORE UPDATE ON advance_allocations WHEN (SELECT status FROM requests WHERE id = OLD.expense_request_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'parent request is not draft'); END;
CREATE TRIGGER trg_requests_content_locked BEFORE UPDATE ON requests
WHEN OLD.status <> 'draft' AND (
     NEW.requester_id IS NOT OLD.requester_id OR NEW.type IS NOT OLD.type OR NEW.title IS NOT OLD.title
  OR NEW.note IS NOT OLD.note OR NEW.project IS NOT OLD.project OR NEW.total_base_minor IS NOT OLD.total_base_minor
  OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by OR NEW.submitted_at IS NOT OLD.submitted_at
)
BEGIN SELECT RAISE(ABORT, 'request content is locked after submit'); END;
CREATE TRIGGER trg_items_request_fixed BEFORE UPDATE OF request_id ON request_items
WHEN NEW.request_id IS NOT OLD.request_id
BEGIN SELECT RAISE(ABORT, 'request_id is immutable'); END;
CREATE TRIGGER trg_alloc_fixed BEFORE UPDATE ON advance_allocations
BEGIN SELECT RAISE(ABORT, 'allocations are immutable'); END;
CREATE INDEX ix_assignments_asset ON assignments (asset_id, assigned_on);
CREATE TABLE fixed_costs (
  id            TEXT PRIMARY KEY CHECK (length(id) = 26),
  month         TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'
                                     AND CAST(substr(month, 6, 2) AS INTEGER) BETWEEN 1 AND 12),
  kind          TEXT NOT NULL CHECK (kind IN ('personnel','office','software','equipment','professional','other')),
  amount_minor  INTEGER NOT NULL CHECK (amount_minor >= 0),
  note          TEXT CHECK (length(note) <= 500),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  created_by    TEXT NOT NULL REFERENCES users(id),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                CHECK (updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)),
  updated_by    TEXT NOT NULL REFERENCES users(id),
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (month, kind)
) STRICT;
CREATE TRIGGER trg_fixed_costs_no_delete BEFORE DELETE ON fixed_costs BEGIN SELECT RAISE(ABORT, 'no delete'); END;
CREATE TABLE finance_settings (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  billable_people    INTEGER CHECK (billable_people BETWEEN 1 AND 500),
  hours_per_person   INTEGER NOT NULL DEFAULT 160 CHECK (hours_per_person BETWEEN 1 AND 744),
  utilization_pct    INTEGER NOT NULL DEFAULT 65 CHECK (utilization_pct BETWEEN 1 AND 100),
  target_margin_pct  INTEGER NOT NULL DEFAULT 25 CHECK (target_margin_pct BETWEEN 0 AND 90),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                     CHECK (updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)),
  updated_by         TEXT REFERENCES users(id)
, try_rate_micro INTEGER CHECK (try_rate_micro > 0), usd_rate_micro INTEGER CHECK (usd_rate_micro > 0), eur_rate_micro INTEGER CHECK (eur_rate_micro > 0), fx_updated_on TEXT CHECK (fx_updated_on = date(fx_updated_on))) STRICT;
CREATE TRIGGER trg_finance_settings_no_delete BEFORE DELETE ON finance_settings BEGIN SELECT RAISE(ABORT, 'no delete'); END;
CREATE TABLE digital_assets (
  id             TEXT PRIMARY KEY CHECK (length(id) = 26),
  kind           TEXT NOT NULL CHECK (kind IN ('software','domain','stock','account')),
  name           TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  vendor         TEXT CHECK (length(vendor) <= 120),
  plan           TEXT CHECK (length(plan) <= 120),
  seats          INTEGER CHECK (seats BETWEEN 1 AND 1000),
  account_email  TEXT CHECK (length(account_email) <= 200),
  owner_id       TEXT REFERENCES users(id),
  renews_on      TEXT CHECK (renews_on = date(renews_on)),
  period         TEXT NOT NULL DEFAULT 'yearly' CHECK (period IN ('monthly','yearly','one_time','free')),
  cost_minor     INTEGER CHECK (cost_minor >= 0),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  note           TEXT CHECK (length(note) <= 1000),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                 CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  created_by     TEXT NOT NULL REFERENCES users(id),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                 CHECK (updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)),
  updated_by     TEXT NOT NULL REFERENCES users(id),
  version        INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
, currency TEXT NOT NULL DEFAULT 'TRY' CHECK (currency IN ('TRY','USD','EUR')), verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)), source TEXT CHECK (length(source) <= 120), last_paid_on TEXT CHECK (last_paid_on = date(last_paid_on)), last_paid_minor INTEGER CHECK (last_paid_minor >= 0), paid_by TEXT CHECK (length(paid_by) <= 120), purpose TEXT CHECK (length(purpose) <= 200)) STRICT;
CREATE INDEX ix_digital_renews ON digital_assets (status, renews_on);
CREATE TRIGGER trg_digital_assets_no_delete BEFORE DELETE ON digital_assets BEGIN SELECT RAISE(ABORT, 'no delete: cancel'); END;
CREATE TABLE digital_asset_users (
  asset_id   TEXT NOT NULL REFERENCES digital_assets(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  added_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  removed_at TEXT CHECK (removed_at = strftime('%Y-%m-%dT%H:%M:%fZ', removed_at)),
  PRIMARY KEY (asset_id, user_id)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER trg_digital_asset_users_no_delete BEFORE DELETE ON digital_asset_users BEGIN SELECT RAISE(ABORT, 'no delete: removed_at'); END;
CREATE TABLE email_outbox (
  id            TEXT PRIMARY KEY CHECK (length(id) = 26),
  to_user_id    TEXT NOT NULL REFERENCES users(id),
  template      TEXT NOT NULL CHECK (template IN ('request_submitted','request_decided','request_paid','agreement_expiring','digital_renewal','pending_reminder')),
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  dedupe_key    TEXT NOT NULL UNIQUE,
  message_json  TEXT NOT NULL CHECK (json_valid(message_json) AND length(message_json) <= 4000),
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  attempts      INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error    TEXT CHECK (length(last_error) <= 500),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  sent_at       TEXT CHECK (sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', sent_at)),
  claimed_at    TEXT CHECK (claimed_at IS NULL OR claimed_at = strftime('%Y-%m-%dT%H:%M:%fZ', claimed_at))
) STRICT;
CREATE INDEX ix_outbox_queue ON email_outbox (status, created_at);
CREATE TRIGGER trg_email_outbox_no_delete BEFORE DELETE ON email_outbox BEGIN SELECT RAISE(ABORT, 'no delete'); END;
CREATE TABLE policy_acceptances (
  id           TEXT PRIMARY KEY CHECK (length(id) = 26),
  user_id      TEXT NOT NULL REFERENCES users(id),
  doc          TEXT NOT NULL CHECK (doc IN ('policy','kvkk')),
  version      TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 40),
  accepted_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               CHECK (accepted_at = strftime('%Y-%m-%dT%H:%M:%fZ', accepted_at)),
  ip           TEXT CHECK (length(ip) <= 64),
  user_agent   TEXT CHECK (length(user_agent) <= 300),
  UNIQUE (user_id, doc, version)
) STRICT;
CREATE TRIGGER trg_policy_acceptances_no_update BEFORE UPDATE ON policy_acceptances BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER trg_policy_acceptances_no_delete BEFORE DELETE ON policy_acceptances BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE leave_statements (
  id            TEXT PRIMARY KEY CHECK (length(id) = 26),
  user_id       TEXT NOT NULL REFERENCES users(id),
  year          INTEGER NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  confirmed_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                CHECK (confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ', confirmed_at)),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  ip            TEXT CHECK (length(ip) <= 64),
  UNIQUE (user_id, year)
) STRICT;
CREATE TRIGGER trg_leave_statements_no_update BEFORE UPDATE ON leave_statements BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER trg_leave_statements_no_delete BEFORE DELETE ON leave_statements BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER trg_requests_pending_approver BEFORE UPDATE OF status ON requests
WHEN NEW.status = 'pending' AND OLD.status <> 'pending' AND NEW.approver_role IS NULL
BEGIN SELECT RAISE(ABORT, 'pending request needs an approver role'); END;
CREATE INDEX ix_requests_pending_approver ON requests (approver_role, submitted_at) WHERE status = 'pending';
CREATE TABLE leave_requests (
  request_id     TEXT PRIMARY KEY,
  type           TEXT NOT NULL DEFAULT 'leave' CHECK (type = 'leave'),
  kind           TEXT NOT NULL CHECK (kind IN ('annual','excuse','sick','unpaid','other')),
  start_date     TEXT NOT NULL CHECK (start_date = date(start_date)),
  end_date       TEXT NOT NULL CHECK (end_date = date(end_date)),
  start_time     TEXT CHECK (start_time IS NULL OR (length(start_time) = 5 AND start_time = strftime('%H:%M', '2000-01-01 ' || start_time))),
  end_time       TEXT CHECK (end_time IS NULL OR (length(end_time) = 5 AND end_time = strftime('%H:%M', '2000-01-01 ' || end_time))),
  work_days      REAL NOT NULL CHECK (work_days > 0 AND work_days <= 366),
  return_date    TEXT CHECK (return_date IS NULL OR return_date = date(return_date)),
  substitute_id  TEXT REFERENCES users(id),
  year           INTEGER NOT NULL,
  CHECK (end_date >= start_date),
  CHECK (year = CAST(substr(start_date, 1, 4) AS INTEGER)),
  CHECK ((start_time IS NULL) = (end_time IS NULL)),
  CHECK (start_time IS NULL OR (start_date = end_date AND end_time > start_time AND work_days < 1)),
  CHECK (return_date IS NULL OR return_date >= end_date),
  FOREIGN KEY (request_id, type) REFERENCES requests (id, type)
) STRICT;
CREATE INDEX ix_leave_dates ON leave_requests (start_date, end_date);
CREATE TRIGGER trg_leave_requests_no_delete BEFORE DELETE ON leave_requests BEGIN SELECT RAISE(ABORT, 'no delete'); END;
CREATE TRIGGER trg_leave_requests_draft_ins BEFORE INSERT ON leave_requests WHEN (SELECT status FROM requests WHERE id = NEW.request_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'parent request is not draft'); END;
CREATE TRIGGER trg_leave_requests_draft_upd BEFORE UPDATE ON leave_requests WHEN (SELECT status FROM requests WHERE id = OLD.request_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'parent request is not draft'); END;
CREATE TABLE expense_requests (
  request_id  TEXT PRIMARY KEY,
  type        TEXT NOT NULL DEFAULT 'expense' CHECK (type = 'expense'),
  iban        TEXT CHECK (iban IS NULL OR (length(iban) BETWEEN 15 AND 34 AND iban GLOB '[A-Z][A-Z][0-9][0-9]*' AND iban NOT GLOB '*[^A-Z0-9]*')),
  FOREIGN KEY (request_id, type) REFERENCES requests (id, type)
) STRICT;
CREATE TRIGGER trg_expense_requests_no_delete BEFORE DELETE ON expense_requests BEGIN SELECT RAISE(ABORT, 'no delete'); END;
CREATE TRIGGER trg_expense_requests_draft_ins BEFORE INSERT ON expense_requests WHEN (SELECT status FROM requests WHERE id = NEW.request_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'parent request is not draft'); END;
CREATE TRIGGER trg_expense_requests_draft_upd BEFORE UPDATE ON expense_requests WHEN (SELECT status FROM requests WHERE id = OLD.request_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'parent request is not draft'); END;
CREATE TABLE advance_closures (
  advance_request_id  TEXT PRIMARY KEY REFERENCES advance_requests (request_id),
  paid_minor          INTEGER NOT NULL CHECK (paid_minor > 0),
  spent_minor         INTEGER NOT NULL CHECK (spent_minor >= 0),
  refund_minor        INTEGER NOT NULL CHECK (refund_minor >= 0),
  note                TEXT CHECK (note IS NULL OR length(note) <= 500),
  closed_at           TEXT NOT NULL CHECK (closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', closed_at)),
  closed_by           TEXT NOT NULL REFERENCES users(id),
  refund_received_at  TEXT CHECK (refund_received_at = strftime('%Y-%m-%dT%H:%M:%fZ', refund_received_at)),
  refund_received_by  TEXT REFERENCES users(id),
  CHECK (paid_minor = spent_minor + refund_minor),
  CHECK ((refund_received_at IS NULL) = (refund_received_by IS NULL)),
  CHECK (refund_minor > 0 OR refund_received_at IS NULL)
) STRICT;
CREATE TRIGGER trg_advance_closures_no_delete BEFORE DELETE ON advance_closures BEGIN SELECT RAISE(ABORT, 'no delete'); END;
CREATE TRIGGER trg_advance_closures_update BEFORE UPDATE ON advance_closures
WHEN OLD.refund_received_at IS NOT NULL
  OR NEW.advance_request_id IS NOT OLD.advance_request_id OR NEW.paid_minor IS NOT OLD.paid_minor OR NEW.spent_minor IS NOT OLD.spent_minor
  OR NEW.refund_minor IS NOT OLD.refund_minor OR NEW.note IS NOT OLD.note OR NEW.closed_at IS NOT OLD.closed_at OR NEW.closed_by IS NOT OLD.closed_by
BEGIN SELECT RAISE(ABORT, 'closure is fixed; only refund receipt can be recorded once'); END;
CREATE TRIGGER trg_alloc_not_closed BEFORE INSERT ON advance_allocations
WHEN EXISTS (SELECT 1 FROM advance_closures WHERE advance_request_id = NEW.advance_request_id)
BEGIN SELECT RAISE(ABORT, 'advance is closed'); END;
CREATE TRIGGER trg_requests_freeze BEFORE UPDATE ON requests
WHEN OLD.status IN ('rejected','paid','cancelled')
  OR (OLD.status IS NEW.status AND OLD.status = 'approved')
  OR (OLD.status IS NEW.status AND OLD.status = 'pending')
BEGIN SELECT RAISE(ABORT, 'request content is frozen after submit'); END;
CREATE TRIGGER trg_leave_requests_days_grid BEFORE INSERT ON leave_requests
WHEN NEW.work_days * 16 <> CAST(NEW.work_days * 16 AS INTEGER)
  OR (NEW.start_time IS NULL AND NEW.work_days * 2 <> CAST(NEW.work_days * 2 AS INTEGER))
BEGIN SELECT RAISE(ABORT, 'leave duration off grid'); END;
CREATE TRIGGER trg_assignments_return_confirm BEFORE UPDATE OF return_confirmed_at, return_confirmed_ip ON assignments
WHEN OLD.return_confirmed_at IS NOT NULL
  OR (NEW.return_confirmed_at IS NOT NULL AND NEW.returned_on IS NULL)
BEGIN SELECT RAISE(ABORT, 'return confirmation is fixed and needs a return'); END;
CREATE TRIGGER trg_assignments_ack_fixed BEFORE UPDATE OF acknowledged_at, acknowledged_ip ON assignments
WHEN OLD.acknowledged_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'acknowledgement is fixed'); END;
CREATE TRIGGER trg_requests_transition BEFORE UPDATE OF status ON requests
WHEN OLD.status <> NEW.status AND NOT (
     (OLD.status = 'draft'    AND NEW.status = 'pending'   AND NEW.auto_approved = 0)
  OR (OLD.status = 'draft'    AND NEW.status = 'approved'  AND NEW.auto_approved = 1)
  OR (OLD.status = 'draft'    AND NEW.status = 'cancelled')
  OR (OLD.status = 'pending'  AND NEW.status IN ('approved','rejected','cancelled') AND NEW.auto_approved = 0)
  OR (OLD.status = 'approved' AND NEW.status = 'paid')
  OR (OLD.status = 'approved' AND NEW.status = 'cancelled' AND OLD.type = 'leave'
      AND (SELECT start_date FROM leave_requests WHERE request_id = OLD.id) > date('now', '+3 hours'))
)
BEGIN SELECT RAISE(ABORT, 'invalid status transition'); END;
CREATE TABLE job_types (
  id            TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 26),
  key           TEXT UNIQUE CHECK (key IS NULL OR key IN ('project','consulting','design','development','marketing','support','other')),
  label         TEXT CHECK (label IS NULL OR length(trim(label)) BETWEEN 1 AND 60),
  sort          INTEGER NOT NULL DEFAULT 0,
  archived_at   TEXT CHECK (archived_at IS NULL OR archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', archived_at)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  created_by    TEXT REFERENCES users(id),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                CHECK (updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)),
  updated_by    TEXT REFERENCES users(id),
  CHECK (key IS NOT NULL OR label IS NOT NULL)
) STRICT;
CREATE TRIGGER trg_job_types_no_delete BEFORE DELETE ON job_types BEGIN SELECT RAISE(ABORT, 'no delete: archive'); END;
INSERT INTO job_types (id, key, sort) VALUES ('project', 'project', 10), ('consulting', 'consulting', 20), ('design', 'design', 30), ('development', 'development', 40), ('marketing', 'marketing', 50), ('support', 'support', 60), ('other', 'other', 70);
CREATE TABLE jobs (
  id            TEXT PRIMARY KEY CHECK (length(id) = 26),
  client        TEXT NOT NULL CHECK (length(trim(client)) BETWEEN 1 AND 120),
  title         TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  unit          TEXT CHECK (length(unit) <= 120),
  kind          TEXT NOT NULL REFERENCES job_types(id),
  status        TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('done','active','not_started')),
  start_date    TEXT CHECK (start_date = date(start_date)),
  end_date      TEXT CHECK (end_date = date(end_date)),
  amount_minor  INTEGER CHECK (amount_minor >= 0),
  note          TEXT CHECK (length(note) <= 2000),
  archived_at   TEXT CHECK (archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', archived_at)),
  archived_by   TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  created_by    TEXT NOT NULL REFERENCES users(id),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                CHECK (updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)),
  updated_by    TEXT NOT NULL REFERENCES users(id),
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1), not_billable INTEGER NOT NULL DEFAULT 0 CHECK (not_billable IN (0,1)),
  CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  CHECK ((archived_at IS NULL) = (archived_by IS NULL))
) STRICT;
CREATE INDEX ix_jobs_list ON jobs (archived_at, status, end_date);
CREATE INDEX ix_jobs_client ON jobs (client);
CREATE TRIGGER trg_jobs_no_delete BEFORE DELETE ON jobs BEGIN SELECT RAISE(ABORT, 'no delete: archive'); END;
CREATE TABLE job_members (
  job_id      TEXT NOT NULL REFERENCES jobs(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  share_bp    INTEGER CHECK (share_bp BETWEEN 0 AND 10000),
  added_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              CHECK (added_at = strftime('%Y-%m-%dT%H:%M:%fZ', added_at)),
  added_by    TEXT NOT NULL REFERENCES users(id),
  removed_at  TEXT CHECK (removed_at = strftime('%Y-%m-%dT%H:%M:%fZ', removed_at)),
  PRIMARY KEY (job_id, user_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_job_members_user ON job_members (user_id, removed_at);
CREATE TRIGGER trg_job_members_no_delete BEFORE DELETE ON job_members BEGIN SELECT RAISE(ABORT, 'no delete: removed_at'); END;
CREATE TABLE accounting_outbox (
  id              TEXT PRIMARY KEY CHECK (length(id) = 26),
  kind            TEXT NOT NULL CHECK (kind IN ('request_approved','invoice_uploaded')),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('request','invoice')),
  entity_id       TEXT NOT NULL CHECK (length(entity_id) = 26),
  dedupe_key      TEXT NOT NULL UNIQUE,
  subject         TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 300),
  body_text       TEXT NOT NULL CHECK (length(body_text) BETWEEN 1 AND 6000),
  attachment_ids  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(attachment_ids) AND json_type(attachment_ids) = 'array'),
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error      TEXT CHECK (length(last_error) <= 500),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                  CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  sent_at         TEXT CHECK (sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', sent_at)),
  claimed_at      TEXT CHECK (claimed_at IS NULL OR claimed_at = strftime('%Y-%m-%dT%H:%M:%fZ', claimed_at)),
  delivered_to    TEXT CHECK (length(delivered_to) <= 1000)
, from_name TEXT CHECK (from_name IS NULL OR (length(from_name) BETWEEN 1 AND 120 AND from_name NOT GLOB '*[' || char(10) || char(13) || '"<>]*')), cc_extra TEXT CHECK (cc_extra IS NULL OR (length(cc_extra) BETWEEN 3 AND 200 AND cc_extra = lower(trim(cc_extra)) AND cc_extra LIKE '%_@_%._%' AND cc_extra NOT GLOB '*[' || char(10) || char(13) || ',;<> ]*')), zip_name TEXT CHECK (zip_name IS NULL OR (length(zip_name) BETWEEN 5 AND 120 AND zip_name GLOB '*.zip')), zip_paths TEXT CHECK (zip_paths IS NULL OR (json_valid(zip_paths) AND json_type(zip_paths) = 'object'))) STRICT;
CREATE INDEX ix_accounting_outbox_queue ON accounting_outbox (status, created_at);
CREATE TRIGGER trg_accounting_outbox_no_delete BEFORE DELETE ON accounting_outbox BEGIN SELECT RAISE(ABORT, 'no delete'); END;
CREATE TRIGGER trg_assignments_dispute_fixed BEFORE UPDATE OF disputed_at, dispute_note ON assignments
WHEN OLD.disputed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'dispute is fixed'); END;
CREATE TABLE invoice_links (
  invoice_id   TEXT NOT NULL REFERENCES invoices(id),
  target_kind  TEXT NOT NULL CHECK (target_kind IN ('asset','digital','job')),
  target_id    TEXT NOT NULL CHECK (length(target_id) = 26),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  created_by   TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (invoice_id, target_kind, target_id)
) STRICT;
CREATE INDEX ix_invoice_links_target ON invoice_links (target_kind, target_id);
CREATE TRIGGER trg_att_request_draft BEFORE INSERT ON attachments
WHEN (
     (NEW.request_id IS NOT NULL AND (SELECT status FROM requests WHERE id = NEW.request_id) <> 'draft'
       AND NOT (NEW.kind = 'health_report'
                AND EXISTS (SELECT 1 FROM requests r JOIN leave_requests l ON l.request_id = r.id
                            WHERE r.id = NEW.request_id AND r.type = 'leave' AND l.kind = 'sick' AND r.status IN ('pending','approved'))))
  OR (NEW.request_item_id IS NOT NULL AND (SELECT r.status FROM request_items it JOIN requests r ON r.id = it.request_id WHERE it.id = NEW.request_item_id) <> 'draft')
)
BEGIN SELECT RAISE(ABORT, 'parent request is not draft'); END;
CREATE UNIQUE INDEX ux_att_health_report ON attachments (request_id) WHERE kind = 'health_report' AND archived_at IS NULL;
CREATE INDEX ix_invoices_approval ON invoices (approval_status, created_at) WHERE archived_at IS NULL;
CREATE TRIGGER trg_invoices_decision_check BEFORE UPDATE OF approval_status ON invoices
WHEN NEW.approval_status <> OLD.approval_status AND (
     OLD.approval_status <> 'pending'
  OR NEW.decided_at IS NULL OR NEW.decided_by IS NULL
  OR (NEW.approval_status = 'rejected' AND length(trim(COALESCE(NEW.decision_note, ''))) = 0)
)
BEGIN SELECT RAISE(ABORT, 'invoice decision invalid'); END;
CREATE TABLE action_tokens (
  id           TEXT PRIMARY KEY CHECK (length(id) = 26),
  token_hash   TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('request','invoice')),
  entity_id    TEXT NOT NULL CHECK (length(entity_id) = 26),
  user_id      TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  expires_at   TEXT NOT NULL CHECK (expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', expires_at)),
  used_at      TEXT CHECK (used_at IS NULL OR used_at = strftime('%Y-%m-%dT%H:%M:%fZ', used_at))
) STRICT;
CREATE INDEX ix_action_tokens_entity ON action_tokens (entity_type, entity_id);
CREATE TRIGGER trg_action_tokens_no_delete BEFORE DELETE ON action_tokens BEGIN SELECT RAISE(ABORT, 'no delete'); END;

INSERT INTO finance_settings (id) VALUES (1);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY CHECK (length(id) = 64),
  user_id       TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  expires_at    TEXT NOT NULL CHECK (expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', expires_at)),
  ip            TEXT CHECK (ip IS NULL OR length(ip) <= 64),
  user_agent    TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 300)
) STRICT;
CREATE INDEX ix_sessions_user ON sessions (user_id);
CREATE INDEX ix_sessions_expires ON sessions (expires_at);

CREATE TABLE auth_tokens (
  id            TEXT PRIMARY KEY CHECK (length(id) = 26),
  token_hash    TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  kind          TEXT NOT NULL CHECK (kind IN ('invite','reset','verify','magic')),
  user_id       TEXT REFERENCES users(id),
  email         TEXT CHECK (email IS NULL OR email = lower(trim(email))),
  role          TEXT CHECK (role IS NULL OR role IN ('employee','manager','approver','owner')),
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                CHECK (created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  expires_at    TEXT NOT NULL CHECK (expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', expires_at)),
  used_at       TEXT CHECK (used_at IS NULL OR used_at = strftime('%Y-%m-%dT%H:%M:%fZ', used_at)),
  CHECK ((kind = 'invite') = (user_id IS NULL)),
  CHECK ((kind = 'invite') = (role IS NOT NULL))
) STRICT;
CREATE INDEX ix_auth_tokens_user ON auth_tokens (user_id, kind);
CREATE TRIGGER trg_auth_tokens_no_delete BEFORE DELETE ON auth_tokens BEGIN SELECT RAISE(ABORT, 'no delete'); END;

CREATE TABLE app_settings (
  key           TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 60),
  value_json    TEXT NOT NULL CHECK (json_valid(value_json) AND length(value_json) <= 20000),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                CHECK (updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)),
  updated_by    TEXT REFERENCES users(id)
) STRICT;

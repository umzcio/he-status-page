-- 002: Admin Features - Categories, Notification Queue, Service Management
-- Depends on: 001_initial_schema.sql

-- Categories table (replaces hardcoded category strings)
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed known categories
INSERT INTO categories (slug, display_name, description, display_order)
VALUES
    ('core', 'Core Applications', 'Core IT applications and services', 1),
    ('academic', 'Academic & Student Services', 'Learning management and student platforms', 2),
    ('business', 'Business Systems', 'Business and enterprise applications', 3),
    ('banner', 'Banner', 'Banner ERP system', 4),
    ('infrastructure', 'Network & Infrastructure', 'Network, servers, and infrastructure', 5),
    ('communication', 'Communication & Collaboration', 'Email, messaging, and collaboration platforms', 6),
    ('learning', 'Teaching & Learning', 'Learning management and academic tools', 7)
ON CONFLICT (slug) DO NOTHING;

-- Add category_id FK to services
ALTER TABLE services ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id);

-- Backfill category_id from existing category column
UPDATE services SET category_id = c.id
FROM categories c
WHERE services.category = c.slug
  AND services.category_id IS NULL;

-- Add retry_count to notification_queue
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- Claim marker: set when a processor claims a row for sending, so overlapping
-- processors/ticks don't send the same notification twice. Cleared on failure
-- so the row remains re-processable; a stale claim is reclaimable after a grace
-- period (see notifications.ts).
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

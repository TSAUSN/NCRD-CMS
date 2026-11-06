-- Enum additions commit separately before commands can use the new value.
ALTER TYPE public.reviewable_type ADD VALUE IF NOT EXISTS 'release';

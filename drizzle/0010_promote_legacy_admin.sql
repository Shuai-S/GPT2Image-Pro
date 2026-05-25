-- Postgres does not allow writing a newly added enum value in the same
-- transaction that added it. Drizzle wraps pending migrations in one
-- transaction, so runtime role lookup promotes the local admin after commit.
SELECT 1;

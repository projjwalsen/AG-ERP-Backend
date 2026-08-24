-- Counted inventory retains its source unit rather than using density conversion.
ALTER TYPE "ProductUnit" ADD VALUE IF NOT EXISTS 'NOS';

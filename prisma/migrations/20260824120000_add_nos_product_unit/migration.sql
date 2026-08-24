-- Add support for count-based inventory quantities such as "400 NOS".
ALTER TYPE "ProductUnit" ADD VALUE IF NOT EXISTS 'NOS';

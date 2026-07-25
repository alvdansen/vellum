-- IDM-03: ROLLBACK NOT SUPPORTED.
--
-- Additive index to support VersionRepo.listPendingVersions() (D-GEN-28
-- recovery-poller query). Old code tolerates the presence of an extra
-- index — index presence is a query-plan optimization, never a schema
-- constraint. No down migration shipped.
CREATE INDEX IF NOT EXISTS `idx_versions_status` ON `versions` (`status`);

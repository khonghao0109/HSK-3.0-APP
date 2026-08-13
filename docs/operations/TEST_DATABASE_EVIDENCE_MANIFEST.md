# Local Test Database Evidence Manifest

- Inventory time: 2026-08-13 (Asia/Ho_Chi_Minh)
- Catalog: local PostgreSQL on the developer workstation
- Scope: read-only names, database owner and aggregate size; no table data or
  credentials were read
- Protected database: `hsk_system` was excluded and never accessed by this task

PostgreSQL does not retain database creation time in `pg_database`, so creation time
is recorded as unavailable rather than inferred. Every inventoried test database is
owned by local role `mtls`. Ownership of the evidence lifecycle is not implied by the
SQL owner; explicit human confirmation is required before deletion.

| Sanitized purpose inferred from name prefix |   Count | Aggregate size | Custodial owner | Retention reason                                     | TTL review deadline |
| ------------------------------------------- | ------: | -------------: | --------------- | ---------------------------------------------------- | ------------------- |
| activity                                    |       9 |         119 MB | `mtls`          | prior integrity/concurrency evidence                 | 2026-08-20          |
| exercise/final                              |      44 |         557 MB | `mtls`          | prior schema/E2E/release evidence                    | 2026-08-20          |
| frontend/admin                              |      10 |         131 MB | `mtls`          | prior frontend/admin E2E evidence                    | 2026-08-20          |
| media                                       |      21 |         273 MB | `mtls`          | prior media API/reconciliation evidence              | 2026-08-20          |
| schema/CMS                                  |      24 |         315 MB | `mtls`          | prior schema/CMS concurrency evidence                | 2026-08-20          |
| other (`hsk_manual_preview_20260812_test`)  |       1 |          13 MB | `mtls`          | manual evidence; purpose requires owner confirmation | 2026-08-20          |
| **Total**                                   | **109** |   **1,408 MB** |                 |                                                      |                     |

The deadline is a review/owner-confirmation deadline, not authorization for automatic
deletion. These 109 databases predate this task and were not reset, truncated,
modified or dropped. Durable evidence belongs in sanitized logs/manifests, not in a
permanently running database.

<details>
<summary>Sanitized exact-name inventory (109)</summary>

- `hsk_activity_concurrency_20260811_disposable`
- `hsk_activity_concurrency_final_20260811_disposable`
- `hsk_activity_concurrency_postclassifier_20260811_disposable`
- `hsk_activity_e2e_postclassifier_20260811_disposable`
- `hsk_activity_final_e2e_20260811_disposable`
- `hsk_activity_full_e2e_final2_20260811_disposable`
- `hsk_activity_full_e2e_retry_20260811_disposable`
- `hsk_activity_integrity_green_20260810_disposable`
- `hsk_activity_integrity_red_20260810_disposable`
- `hsk_admin_ui_fidelity_20260812_test`
- `hsk_admin_ui_fidelity_review_20260812_test`
- `hsk_admin_ui_final_20260812_test`
- `hsk_admin_ui_red_20260812_test`
- `hsk_closeout_cms_race_20260810_disposable`
- `hsk_closeout_e2e_20260810_disposable`
- `hsk_closeout_final_e2e_20260810_disposable`
- `hsk_closeout_final_p0_20260810_disposable`
- `hsk_closeout_p0_20260810_disposable`
- `hsk_closeout_red_20260810_disposable`
- `hsk_cms_concurrency_20260810_disposable`
- `hsk_cms_concurrency_final_20260811_disposable`
- `hsk_cms_concurrency_postclassifier_20260811_disposable`
- `hsk_cms_e2e2_20260810_disposable`
- `hsk_cms_e2e_20260810_disposable`
- `hsk_cms_final_e2e_20260810_disposable`
- `hsk_cms_full_e2e_20260810_disposable`
- `hsk_cms_service_final_20260810_disposable`
- `hsk_cms_service_mutation_20260810_disposable`
- `hsk_cms_service_race_20260810_disposable`
- `hsk_exa_preflight_archive_20260811_test`
- `hsk_exa_preflight_parent_20260811_test`
- `hsk_exa_preflight_published_20260811_test`
- `hsk_exa_preflight_revision_20260811_test`
- `hsk_exercise_authoring_disposable_test`
- `hsk_exercise_baseline_activity_20260811_test`
- `hsk_exercise_baseline_cms_20260811_test`
- `hsk_exercise_baseline_gate_20260811_test`
- `hsk_exercise_baseline_p0_20260811_test`
- `hsk_exercise_concurrency_test_2026081101`
- `hsk_exercise_concurrency_test_2026081102`
- `hsk_exercise_concurrency_test_2026081103`
- `hsk_exercise_docs_shadow_20260811_1845_test`
- `hsk_exercise_docs_verify_20260811_1845_test`
- `hsk_exercise_e2e_green_20260811_1035_test`
- `hsk_exercise_e2e_green_20260811_1048_test`
- `hsk_exercise_e2e_test_2026081101`
- `hsk_exercise_e2e_test_2026081102`
- `hsk_exercise_e2e_test_2026081103`
- `hsk_exercise_final7_concurrency_20260811_test`
- `hsk_exercise_final_concurrency_20260811_test`
- `hsk_exercise_final_concurrency_shadow_20260811_test`
- `hsk_exercise_final_e2e_orderindex_20260811_test`
- `hsk_exercise_final_focus_e2e_20260811_test`
- `hsk_exercise_full_e2e_final_20260811_test`
- `hsk_exercise_green_same_admin_20260811_test`
- `hsk_exercise_media_nowhitespace_preflight_20260811_2030_test`
- `hsk_exercise_media_nowhitespace_shadow_20260811_2030_test`
- `hsk_exercise_media_nowhitespace_verify_20260811_2030_test`
- `hsk_exercise_media_preflight_20260811_1930_test`
- `hsk_exercise_media_shadow_20260811_1930_test`
- `hsk_exercise_media_trim_preflight_20260811_2000_test`
- `hsk_exercise_media_trim_shadow_20260811_2000_test`
- `hsk_exercise_media_trim_verify_20260811_2000_test`
- `hsk_exercise_media_verify_20260811_1930_test`
- `hsk_exercise_red_same_admin_20260811_test`
- `hsk_exercise_schema_green_20260811_test`
- `hsk_final_activity_concurrency_74944a7_20260811_test`
- `hsk_final_cms_concurrency_74944a7_20260811_test`
- `hsk_final_e2e_74944a7_20260811_test`
- `hsk_final_exercise_concurrency_74944a7_20260811_test`
- `hsk_final_integrity2_74944a7_20260811_test`
- `hsk_final_integrity_74944a7_20260811_test`
- `hsk_final_p0_concurrency_74944a7_20260811_test`
- `hsk_frontend_atomicity_20260812_test`
- `hsk_frontend_backend_e2e_20260811_test`
- `hsk_frontend_console_20260811_test`
- `hsk_frontend_csp_closeout_20260811_test`
- `hsk_frontend_session_csp_20260811_test`
- `hsk_frontend_tablet_closeout_20260812_test`
- `hsk_integration_postclassifier_20260811_disposable`
- `hsk_legacy_activity_concurrency_20260811_test`
- `hsk_legacy_activity_integrity_20260811_test`
- `hsk_legacy_cms_concurrency_20260811_test`
- `hsk_legacy_p0_concurrency_20260811_test`
- `hsk_legacy_p0_schema_20260811_test`
- `hsk_manual_preview_20260812_test`
- `hsk_media_admin_frontend_20260812_test`
- `hsk_media_admin_race_20260812_test`
- `hsk_media_admin_v1_20260812_test`
- `hsk_media_api_final2_20260812_test`
- `hsk_media_api_final_20260812_test`
- `hsk_media_browser_final2_20260812_test`
- `hsk_media_browser_final3_20260812_test`
- `hsk_media_browser_final_20260812_test`
- `hsk_media_final2_e2e_e333c0b_20260813_test`
- `hsk_media_final2_integrity_e333c0b_20260813_test`
- `hsk_media_final2_shadow_e333c0b_20260813_test`
- `hsk_media_final_e2e_9aa6c3b_20260813_test`
- `hsk_media_final_integrity_9aa6c3b_20260813_test`
- `hsk_media_final_shadow_9aa6c3b_20260813_test`
- `hsk_media_hardening_green1_20260813_test`
- `hsk_media_hardening_green2_20260813_test`
- `hsk_media_postcommit_e2e2_77e2952_20260813_test`
- `hsk_media_postcommit_e2e_77e2952_20260813_test`
- `hsk_media_preflight_ambiguous_9aa6c3b_20260813_test`
- `hsk_media_preflight_completed_9aa6c3b_20260813_test`
- `hsk_media_red_provenance_20260813_test`
- `hsk_p0_concurrency_final_20260811_disposable`
- `hsk_p0_concurrency_postclassifier_20260811_disposable`

</details>

## Databases created by this closeout

| Database                               | Purpose/result                                                                                                              | Cleanup |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------- |
| `hsk_obs_edge_integrity_20260813_test` | fresh 17-migration deploy; media SQL PASS/ROLLBACK; live drift empty; post-test User/Media/MediaIngestion/AuditLog all zero | dropped |
| `hsk_obs_edge_fencing_20260813_test`   | fresh 17-migration deploy; media fencing E2E 13/13 PASS                                                                     | dropped |
| `hsk_obs_edge_e2e_20260813_test`       | fresh deploy; first full E2E invocation rejected missing test JWT config and was not reused                                 | dropped |
| `hsk_obs_edge_e2e2_20260813_test`      | replacement fresh 17-migration deploy; full backend E2E 11 suites/160 tests PASS                                            | dropped |
| `hsk_obs_edge_shadow_20260813_test`    | isolated migration-history shadow drift; no difference                                                                      | dropped |
| `hsk_obs_edge_final_e2e_20260813_test` | final-source fresh 17-migration deploy; full backend E2E 11 suites/160 tests PASS                                           | dropped |

The final prefix-scoped catalog query returned `0` for all six exact task names. No
database was reset or truncated, and no pre-existing database was modified or
deleted.

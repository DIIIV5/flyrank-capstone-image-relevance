-- Closed-set labels live in config.yaml. Keep a format check so junk still fails.

ALTER TABLE images DROP CONSTRAINT IF EXISTS images_label_check;
ALTER TABLE images DROP CONSTRAINT IF EXISTS images_runner_up_label_check;
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_expected_label_check;

ALTER TABLE images ADD CONSTRAINT images_label_check
  CHECK (label IS NULL OR label ~ '^[a-z][a-z0-9_]*$');

ALTER TABLE images ADD CONSTRAINT images_runner_up_label_check
  CHECK (runner_up_label IS NULL OR runner_up_label ~ '^[a-z][a-z0-9_]*$');

ALTER TABLE posts ADD CONSTRAINT posts_expected_label_check
  CHECK (expected_label IS NULL OR expected_label ~ '^[a-z][a-z0-9_]*$');

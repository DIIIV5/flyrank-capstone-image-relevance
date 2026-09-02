-- Add cat and big cat to the label set.

ALTER TABLE images DROP CONSTRAINT IF EXISTS images_label_check;
ALTER TABLE images DROP CONSTRAINT IF EXISTS images_runner_up_label_check;

ALTER TABLE images ADD CONSTRAINT images_label_check
  CHECK (
    label IS NULL OR label IN (
      'fox', 'wolf', 'dog', 'cat', 'big cat', 'bear', 'deer', 'other'
    )
  );

ALTER TABLE images ADD CONSTRAINT images_runner_up_label_check
  CHECK (
    runner_up_label IS NULL OR runner_up_label IN (
      'fox', 'wolf', 'dog', 'cat', 'big cat', 'bear', 'deer', 'other'
    )
  );

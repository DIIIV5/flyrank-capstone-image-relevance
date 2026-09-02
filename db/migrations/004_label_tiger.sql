-- Rename closed-set label 'big cat' to 'tiger'.

ALTER TABLE images DROP CONSTRAINT IF EXISTS images_label_check;
ALTER TABLE images DROP CONSTRAINT IF EXISTS images_runner_up_label_check;
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_expected_label_check;

UPDATE images SET label = 'tiger' WHERE label = 'big cat';
UPDATE images SET runner_up_label = 'tiger' WHERE runner_up_label = 'big cat';
UPDATE posts SET expected_label = 'tiger' WHERE expected_label = 'big cat';

ALTER TABLE images ADD CONSTRAINT images_label_check
  CHECK (
    label IS NULL OR label IN (
      'fox', 'wolf', 'dog', 'cat', 'tiger', 'bear', 'deer', 'other'
    )
  );

ALTER TABLE images ADD CONSTRAINT images_runner_up_label_check
  CHECK (
    runner_up_label IS NULL OR runner_up_label IN (
      'fox', 'wolf', 'dog', 'cat', 'tiger', 'bear', 'deer', 'other'
    )
  );

ALTER TABLE posts ADD CONSTRAINT posts_expected_label_check
  CHECK (
    expected_label IS NULL OR expected_label IN (
      'fox', 'wolf', 'dog', 'cat', 'tiger', 'bear', 'deer', 'other'
    )
  );

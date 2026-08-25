-- Keep CHECK constraints in sync with IMAGE_LABELS in src/types.ts.
-- Add closed-set labels cow and chicken (eval folders under data/images/eval).

ALTER TABLE images DROP CONSTRAINT IF EXISTS images_label_check;
ALTER TABLE images DROP CONSTRAINT IF EXISTS images_runner_up_label_check;
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_expected_label_check;

ALTER TABLE images ADD CONSTRAINT images_label_check
  CHECK (
    label IS NULL OR label IN (
      'fox', 'wolf', 'dog', 'cat', 'tiger', 'bear', 'deer', 'cow', 'chicken', 'other'
    )
  );

ALTER TABLE images ADD CONSTRAINT images_runner_up_label_check
  CHECK (
    runner_up_label IS NULL OR runner_up_label IN (
      'fox', 'wolf', 'dog', 'cat', 'tiger', 'bear', 'deer', 'cow', 'chicken', 'other'
    )
  );

ALTER TABLE posts ADD CONSTRAINT posts_expected_label_check
  CHECK (
    expected_label IS NULL OR expected_label IN (
      'fox', 'wolf', 'dog', 'cat', 'tiger', 'bear', 'deer', 'cow', 'chicken', 'other'
    )
  );

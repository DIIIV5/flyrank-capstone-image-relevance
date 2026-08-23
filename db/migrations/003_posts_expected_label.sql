-- Keep CHECK constraints in sync with IMAGE_LABELS in src/types.ts.

ALTER TABLE posts ADD COLUMN expected_label text;

ALTER TABLE posts ADD CONSTRAINT posts_expected_label_check
  CHECK (
    expected_label IS NULL OR expected_label IN (
      'fox', 'wolf', 'dog', 'cat', 'big cat', 'bear', 'deer', 'other'
    )
  );

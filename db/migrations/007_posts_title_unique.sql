-- seed-posts upserts by title, so the title must be unique.

ALTER TABLE posts ADD CONSTRAINT posts_title_key UNIQUE (title);

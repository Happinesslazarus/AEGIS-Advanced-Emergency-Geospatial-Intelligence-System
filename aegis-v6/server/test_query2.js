const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Happylove%40%21@localhost:5432/aegis' });

const sql = `
  SELECT 
    p.id, p.author_id, p.content,
    COALESCE(c.display_name, o.display_name, 'Unknown') as author_name,
    COALESCE(c.role::text, o.role::text, 'citizen') as author_role,
    COUNT(DISTINCT l.id) as likes_count,
    EXISTS(SELECT 1 FROM community_post_likes WHERE post_id = p.id AND user_id = $1) as is_liked_by_user
  FROM community_posts p
  LEFT JOIN citizens c ON p.author_id = c.id
  LEFT JOIN operators o ON p.author_id = o.id
  LEFT JOIN community_post_likes l ON p.id = l.post_id
  LEFT JOIN community_comments cm ON p.id = cm.post_id
  LEFT JOIN community_post_shares sh ON p.id = sh.post_id
  WHERE p.deleted_at IS NULL
  GROUP BY p.id, c.id, o.id
  ORDER BY p.created_at DESC
  LIMIT 100
`;

pool.query(sql, ['ea5c0f12-8a4f-49de-acd0-71efba3b7b83'])
  .then(r => console.log('OK, rows:', r.rows.length))
  .catch(e => console.error('ERROR:', e.message))
  .finally(() => pool.end());

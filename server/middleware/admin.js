// middleware/admin.js
import { supabase } from '../index.js';

export async function adminMiddleware(req, res, next) {
  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('id', req.user.id)
    .single();

  if (!userData || userData.role !== 'admin') {
    return res.status(403).json({ error: 'Только для администратора' });
  }
  next();
}

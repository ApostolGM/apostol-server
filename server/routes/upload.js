// routes/upload.js
import { Router } from 'express';
import { supabase } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validate.js';

const router = Router();

router.post('/file', authMiddleware, validate(schemas.uploadFile), async (req, res) => {
  const { image, name, campaign_id } = req.body;

  try {
    const formData = new URLSearchParams();
    formData.append('key', process.env.IMGBB_API_KEY);
    formData.append('image', image);

    const response = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      body: formData,
    });
    const result = await response.json();

    if (result.success) {
      const url = result.data.url;
      if (campaign_id) {
        await supabase.from('backgrounds').insert({ campaign_id, name, url });
      }
      res.json({ url, name, success: true });
    } else {
      res.status(500).json({ error: 'Ошибка загрузки на ImgBB' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

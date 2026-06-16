// routes/upload.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { cloudinary } from '../config/cloudinary.js';
import { authMiddleware, validate, schemas } from '../middleware.js';

const router = Router();

// POST /api/upload/file (ImgBB)
router.post('/file', authMiddleware, validate(schemas.uploadFile), async (req, res) => {
  const { image, name, campaign_id } = req.body;
  try {
    const formData = new URLSearchParams();
    formData.append('key', process.env.IMGBB_API_KEY);
    formData.append('image', image);
    const response = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: formData });
    const result = await response.json();
    if (result.success) {
      const url = result.data.url;
      if (campaign_id) await supabase.from('backgrounds').insert({ campaign_id, name, url });
      res.json({ url, name, success: true });
    } else {
      res.status(500).json({ error: 'Ошибка загрузки на ImgBB' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/upload/sound (Cloudinary)
router.post('/sound', authMiddleware, validate(schemas.uploadSound), async (req, res) => {
  const { sound_data, name, campaign_id, is_global } = req.body;
  try {
    const result = await cloudinary.uploader.upload(sound_data, {
      folder: 'apostol-sounds',
      public_id: name.replace(/\.[^.]+$/, ''),
      resource_type: 'auto'
    });
    const url = result.secure_url;
    if (campaign_id || is_global) {
      await supabase.from('sounds').insert({
        campaign_id: is_global ? null : campaign_id,
        name,
        file_url: url,
        source_type: 'upload',
        duration: result.duration || 0,
        category: 'общее',
        is_global: is_global || false
      });
    }
    res.json({ url, name, duration: result.duration, success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/upload/background
router.post('/background', authMiddleware, async (req, res) => {
  const { campaign_id, name, url, is_global } = req.body;
  if (!url) return res.status(400).json({ error: 'url обязателен' });
  const { data, error } = await supabase.from('backgrounds').insert({
    campaign_id: is_global ? null : campaign_id, name, url, is_global: is_global || false
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;

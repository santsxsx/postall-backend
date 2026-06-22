require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fetch = require('node-fetch');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const META_APP_ID = process.env.META_APP_ID || '271894055173767';
const META_APP_SECRET = process.env.META_APP_SECRET || '';

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

app.get('/', (req, res) => {
  res.json({ status: 'PostAll backend rodando!' });
});

app.get('/auth/instagram', (req, res) => {
  const REDIRECT_URI = process.env.REDIRECT_URI;
  const scopes = 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement';
  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}&response_type=code`;
  res.json({ url: authUrl });
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Codigo nao encontrado' });

  try {
    const REDIRECT_URI = process.env.REDIRECT_URI;
    const tokenRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: META_APP_ID, client_secret: META_APP_SECRET, redirect_uri: REDIRECT_URI, code })
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) return res.status(400).json({ error: tokenData.error.message });

    const longTokenRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${tokenData.access_token}`);
    const longTokenData = await longTokenRes.json();

    const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${longTokenData.access_token}`);
    const pagesData = await pagesRes.json();

    const accounts = [];
    for (const page of (pagesData.data || [])) {
      const igRes = await fetch(`https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`);
      const igData = await igRes.json();
      if (igData.instagram_business_account) {
        const igId = igData.instagram_business_account.id;
        const profileRes = await fetch(`https://graph.facebook.com/v18.0/${igId}?fields=username,name&access_token=${page.access_token}`);
        const profileData = await profileRes.json();
        accounts.push({ id: igId, username: profileData.username, name: profileData.name, pageToken: page.access_token });
      }
    }
    res.json({ success: true, accounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/post/all', upload.single('video'), async (req, res) => {
  const { accounts, caption } = req.body;
  const videoFile = req.file;
  if (!accounts || !videoFile) return res.status(400).json({ error: 'Dados incompletos' });

  let accountsList;
  try { accountsList = JSON.parse(accounts); } catch { return res.status(400).json({ error: 'Lista invalida' }); }

  const results = [];
  for (const account of accountsList) {
    try {
      const initRes = await fetch(`https://graph.facebook.com/v18.0/${account.id}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_type: 'REELS', video_url: `${process.env.BASE_URL}/uploads/${videoFile.filename}`, caption: caption || '', access_token: account.pageToken })
      });
      const initData = await initRes.json();
      if (initData.error) { results.push({ account: account.username, success: false, error: initData.error.message }); continue; }

      let status = 'IN_PROGRESS', attempts = 0;
      while (status === 'IN_PROGRESS' && attempts < 20) {
        await new Promise(r => setTimeout(r, 5000));
        attempts++;
        const s = await (await fetch(`https://graph.facebook.com/v18.0/${initData.id}?fields=status_code&access_token=${account.pageToken}`)).json();
        status = s.status_code;
      }

      if (status !== 'FINISHED') { results.push({ account: account.username, success: false, error: status }); continue; }

      const publishRes = await fetch(`https://graph.facebook.com/v18.0/${account.id}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: initData.id, access_token: account.pageToken })
      });
      const publishData = await publishRes.json();
      if (publishData.error) results.push({ account: account.username, success: false, error: publishData.error.message });
      else results.push({ account: account.username, success: true, postId: publishData.id });
    } catch (err) {
      results.push({ account: account.username, success: false, error: err.message });
    }
  }

  if (videoFile && fs.existsSync(videoFile.path)) fs.unlinkSync(videoFile.path);
  res.json({ success: true, message: `Postado em ${results.filter(r=>r.success).length} de ${accountsList.length} conta(s)`, results });
});

app.use('/uploads', express.static('uploads'));
app.listen(PORT, () => console.log(`PostAll rodando na porta ${PORT}`));

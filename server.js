const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db');
const moment = require('moment');

const app = express();
const PORT = 3100;

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// --- YARDIMCI FONKSİYONLAR ---
const getFirmaBilgileri = () => {
    return db.prepare("SELECT * FROM firma_bilgileri WHERE id = 1").get();
};

const formatTutar = (tutar) => {
    return parseFloat(tutar).toLocaleString('tr-TR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
};

// Ortak verileri (Dropdownlar vb. için) getir
const getCommonData = () => {
    const cariler = db.prepare("SELECT * FROM contacts ORDER BY ad_soyad ASC").all();
    const ustalar = db.prepare("SELECT * FROM contacts WHERE tip = 'Usta' ORDER BY ad_soyad ASC").all();
    
    return {
        cariler: cariler,
        ustalar: ustalar
    };
};

// --- ROTALAR ---

// 1. DASHBOARD
app.get('/', (req, res) => {
    try {
        const toplamAlacakSorgusu = db.prepare("SELECT SUM(CASE WHEN islem_tipi = 'Satis' THEN tutar ELSE -tutar END) as toplam FROM transactions");
        const toplamAlacak = toplamAlacakSorgusu.get().toplam || 0;

        // Son İşlemler (Limit 50)
        const sonIslemler = db.prepare(`
            SELECT t.*, c.ad_soyad, sc.ad_soyad as alt_musteri_adi 
            FROM transactions t
            JOIN contacts c ON t.contact_id = c.id
            LEFT JOIN sub_contacts sc ON t.sub_contact_id = sc.id
            ORDER BY t.tarih DESC
            LIMIT 50
        `).all();

        // Borçlu Cariler
        const cariler = db.prepare("SELECT * FROM contacts").all();
        const enBorclular = cariler.map(cari => {
            const bakiye = db.prepare(`
                SELECT SUM(CASE WHEN islem_tipi = 'Satis' THEN tutar ELSE -tutar END) as bakiye 
                FROM transactions WHERE contact_id = ?
            `).get(cari.id).bakiye || 0;
            return { ...cari, bakiye };
        })
        .filter(c => c.bakiye > 0)
        .sort((a, b) => b.bakiye - a.bakiye)
        .slice(0, 15);

        const commonData = getCommonData();

        res.render('index', {
            firma: getFirmaBilgileri(),
            formatTutar: formatTutar,
            moment: moment,
            currentPage: 'dashboard',
            toplamAlacak: toplamAlacak,
            sonIslemler: sonIslemler,
            enBorclular: enBorclular,
            cariler: commonData.cariler,
            ustalar: commonData.ustalar
        });
    } catch (error) {
        console.error("Dashboard hatası:", error);
        res.status(500).send("Sunucu hatası");
    }
});

// 2. EKSTRE / RAPORLAR
app.get('/ekstre', (req, res) => {
    try {
        const { cari_id, alt_musteri_id, baslangic, bitis } = req.query;
        
        let sql = `
            SELECT t.*, c.ad_soyad, c.tip, sc.ad_soyad as alt_musteri_adi, sc.arac_plaka
            FROM transactions t
            JOIN contacts c ON t.contact_id = c.id
            LEFT JOIN sub_contacts sc ON t.sub_contact_id = sc.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (cari_id) { sql += ' AND t.contact_id = ?'; params.push(cari_id); }
        if (alt_musteri_id) { sql += ' AND t.sub_contact_id = ?'; params.push(alt_musteri_id); }
        if (baslangic) { sql += ' AND t.tarih >= ?'; params.push(baslangic); }
        if (bitis) { sql += ' AND t.tarih <= ?'; params.push(bitis + ' 23:59:59'); }
        
        sql += ' ORDER BY sc.ad_soyad ASC, t.tarih DESC';
        
        const rawTransactions = db.prepare(sql).all(...params);

        // --- GRUPLAMA MANTIĞI ---
        const groups = {};
        let genelToplam = 0;
        let dataMinDate = null;
        let dataMaxDate = null;

        rawTransactions.forEach(islem => {
            const islemTutar = islem.islem_tipi === 'Satis' ? islem.tutar : -islem.tutar;
            genelToplam += islemTutar;

            if (!dataMinDate || islem.tarih < dataMinDate) dataMinDate = islem.tarih;
            if (!dataMaxDate || islem.tarih > dataMaxDate) dataMaxDate = islem.tarih;

            const uniqueKey = islem.contact_id + '_' + (islem.sub_contact_id || 'main');
            const plaka = islem.arac_plaka || '';

            if (!groups[uniqueKey]) {
                let gorunenIsim = islem.ad_soyad;
                if (islem.alt_musteri_adi) {
                    gorunenIsim = `${islem.ad_soyad} - ${islem.alt_musteri_adi}`;
                }

                groups[uniqueKey] = {
                    ad: gorunenIsim,
                    plaka: plaka,
                    islemler: [],
                    toplam: 0
                };
            }

            groups[uniqueKey].islemler.push(islem);
            groups[uniqueKey].toplam += islemTutar;
        });

        const groupedReport = Object.values(groups);

        // Alt müşterileri getir (Filtre için)
        const tumAltMusteriler = db.prepare(`
            SELECT sc.*, c.ad_soyad as usta_adi 
            FROM sub_contacts sc 
            JOIN contacts c ON sc.parent_contact_id = c.id 
            ORDER BY c.ad_soyad, sc.ad_soyad
        `).all();

        const commonData = getCommonData();
        
        res.render('index', {
            firma: getFirmaBilgileri(),
            formatTutar: formatTutar,
            moment: moment,
            currentPage: 'ekstre',
            groupedReport: groupedReport,
            genelToplam: genelToplam,
            cariler: commonData.cariler,
            ustalar: commonData.ustalar,
            tumAltMusteriler: tumAltMusteriler,
            seciliCari: cari_id,
            seciliAltMusteri: alt_musteri_id,
            baslangicTarih: baslangic,
            bitisTarih: bitis,
            raporBaslangic: baslangic || dataMinDate, 
            raporBitis: bitis || dataMaxDate
        });
        
    } catch (error) {
        console.error("Ekstre hatası:", error);
        res.status(500).send("Ekstre yüklenemedi");
    }
});

// 3. CARİLER
app.get('/cariler', (req, res) => {
    try {
        const { arama, tip } = req.query;

        let sql = `
            SELECT c.*, 
                   (SELECT COUNT(*) FROM sub_contacts WHERE parent_contact_id = c.id) as alt_musteri_sayisi,
                   COALESCE((
                       SELECT SUM(CASE WHEN t.islem_tipi = 'Satis' THEN t.tutar ELSE -t.tutar END) 
                       FROM transactions t 
                       WHERE t.contact_id = c.id
                   ), 0) as bakiye
            FROM contacts c
            WHERE 1=1
        `;

        const params = [];

        if (arama) {
            sql += ' AND (c.ad_soyad LIKE ? OR c.telefon LIKE ?)';
            params.push(`%${arama}%`, `%${arama}%`);
        }

        if (tip) {
            sql += ' AND c.tip = ?';
            params.push(tip);
        }

        sql += ' ORDER BY bakiye DESC, c.ad_soyad ASC';
        
        const cariler = db.prepare(sql).all(...params);
        const commonData = getCommonData();
        
        res.render('index', {
            firma: getFirmaBilgileri(),
            formatTutar: formatTutar,
            moment: moment,
            currentPage: 'cariler',
            cariler: cariler,
            ustalar: commonData.ustalar,
            filtreArama: arama,
            filtreTip: tip
        });
    } catch (error) {
        console.error("Cariler hatası:", error);
        res.status(500).send("Cariler yüklenemedi");
    }
});

// 4. ALT MÜŞTERİLER
app.get('/alt-musteriler', (req, res) => {
    try {
        const { usta_id, arama } = req.query;

        let sql = `
            SELECT sc.*, c.ad_soyad as usta_adi
            FROM sub_contacts sc
            JOIN contacts c ON sc.parent_contact_id = c.id
            WHERE 1=1
        `;

        const params = [];

        if (usta_id) {
            sql += ' AND sc.parent_contact_id = ?';
            params.push(usta_id);
        }

        if (arama) {
            sql += ' AND (sc.ad_soyad LIKE ? OR sc.arac_plaka LIKE ?)';
            params.push(`%${arama}%`, `%${arama}%`);
        }

        sql += ' ORDER BY c.ad_soyad, sc.ad_soyad';

        const altMusteriler = db.prepare(sql).all(...params);
        const commonData = getCommonData();
        
        res.render('index', {
            firma: getFirmaBilgileri(),
            formatTutar: formatTutar,
            moment: moment,
            currentPage: 'alt-musteriler',
            altMusteriler: altMusteriler,
            cariler: commonData.cariler,
            ustalar: commonData.ustalar,
            filtreUsta: usta_id,
            filtreArama: arama
        });
    } catch (error) {
        console.error("Alt müşteriler hatası:", error);
        res.status(500).send("Alt müşteriler yüklenemedi");
    }
});

// 5. İŞLEMLER (GÜNCELLENDİ: Alt Müşteri Filtresi Eklendi)
app.get('/islemler', (req, res) => {
    try {
        const { cari_id, alt_musteri_id, baslangic, bitis, islem_tipi } = req.query;

        let sql = `
            SELECT t.*, c.ad_soyad, sc.ad_soyad as alt_musteri_adi, sc.arac_plaka
            FROM transactions t
            JOIN contacts c ON t.contact_id = c.id
            LEFT JOIN sub_contacts sc ON t.sub_contact_id = sc.id
            WHERE 1=1
        `;

        const params = [];

        if (cari_id) { sql += ' AND t.contact_id = ?'; params.push(cari_id); }
        if (alt_musteri_id) { sql += ' AND t.sub_contact_id = ?'; params.push(alt_musteri_id); } // YENİ
        if (islem_tipi) { sql += ' AND t.islem_tipi = ?'; params.push(islem_tipi); }
        if (baslangic) { sql += ' AND t.tarih >= ?'; params.push(baslangic); }
        if (bitis) { sql += ' AND t.tarih <= ?'; params.push(bitis + ' 23:59:59'); }

        sql += ' ORDER BY t.tarih DESC';

        const islemler = db.prepare(sql).all(...params);
        
        // Filtre dropdown'ı için tüm alt müşterileri getir
        const tumAltMusteriler = db.prepare(`
            SELECT sc.*, c.ad_soyad as usta_adi 
            FROM sub_contacts sc 
            JOIN contacts c ON sc.parent_contact_id = c.id 
            ORDER BY c.ad_soyad, sc.ad_soyad
        `).all();

        const commonData = getCommonData();

        res.render('index', {
            firma: getFirmaBilgileri(),
            formatTutar: formatTutar,
            moment: moment,
            currentPage: 'islemler',
            islemler: islemler,
            cariler: commonData.cariler,
            ustalar: commonData.ustalar,
            tumAltMusteriler: tumAltMusteriler, // YENİ
            filtre: { cari_id, alt_musteri_id, baslangic, bitis, islem_tipi }
        });
    } catch (error) {
        console.error("İşlemler sayfası hatası:", error);
        res.status(500).send("İşlemler yüklenemedi");
    }
});

// 6. AYARLAR
app.get('/firma-ayarlar', (req, res) => {
    const commonData = getCommonData();
    res.render('index', {
        firma: getFirmaBilgileri(),
        formatTutar: formatTutar,
        moment: moment,
        currentPage: 'ayarlar',
        cariler: commonData.cariler,
        ustalar: commonData.ustalar
    });
});

// --- CRUD ROTALARI ---

app.post('/firma-guncelle', (req, res) => {
    const { firma_adi, adres, telefon, vergi_dairesi, vergi_no } = req.body;
    db.prepare(`
        UPDATE firma_bilgileri 
        SET firma_adi = ?, adres = ?, telefon = ?, vergi_dairesi = ?, vergi_no = ?
        WHERE id = 1
    `).run(firma_adi, adres, telefon, vergi_dairesi, vergi_no);
    res.redirect('/firma-ayarlar');
});

app.post('/islem-kaydet', (req, res) => {
    const { contact_id, sub_contact_id, islem_tipi, tutar, urun_aciklama, aciklama, tarih } = req.body;
    const finalSubContactId = sub_contact_id === "" ? null : sub_contact_id;
    const finalTarih = tarih ? tarih : moment().format('YYYY-MM-DD HH:mm:ss');

    db.prepare(`
        INSERT INTO transactions (contact_id, sub_contact_id, islem_tipi, tutar, urun_aciklama, aciklama, tarih)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(contact_id, finalSubContactId, islem_tipi, parseFloat(tutar), urun_aciklama, aciklama, finalTarih);
    res.redirect(req.headers.referer || '/');
});

app.post('/islem-guncelle', (req, res) => {
    try {
        const { id, contact_id, sub_contact_id, islem_tipi, tutar, urun_aciklama, aciklama, tarih } = req.body;
        const finalSubContactId = sub_contact_id === "" ? null : sub_contact_id;
        
        db.prepare(`
            UPDATE transactions 
            SET contact_id = ?, sub_contact_id = ?, islem_tipi = ?, tutar = ?, urun_aciklama = ?, aciklama = ?, tarih = ?
            WHERE id = ?
        `).run(contact_id, finalSubContactId, islem_tipi, parseFloat(tutar), urun_aciklama, aciklama, tarih, id);
        res.redirect(req.headers.referer || '/');
    } catch (error) {
        console.error("İşlem güncelleme hatası:", error);
        res.redirect('/');
    }
});

app.get('/islem-sil/:id', (req, res) => {
    try {
        db.prepare("DELETE FROM transactions WHERE id = ?").run(req.params.id);
        res.redirect(req.headers.referer || '/');
    } catch (error) {
        console.error("İşlem silme hatası:", error);
        res.redirect('/');
    }
});

app.post('/musteri-kaydet', (req, res) => {
    const { ad_soyad, tip, telefon } = req.body;
    db.prepare("INSERT INTO contacts (ad_soyad, tip, telefon) VALUES (?, ?, ?)").run(ad_soyad, tip, telefon);
    res.redirect('/cariler');
});

app.post('/cari-guncelle', (req, res) => {
    const { id, ad_soyad, tip, telefon } = req.body;
    db.prepare("UPDATE contacts SET ad_soyad = ?, tip = ?, telefon = ? WHERE id = ?").run(ad_soyad, tip, telefon, id);
    res.redirect('/cariler');
});

app.get('/cari-sil/:id', (req, res) => {
    const id = req.params.id;
    const islemSayisi = db.prepare("SELECT count(*) as count FROM transactions WHERE contact_id = ?").get(id);
    const altMusteriSayisi = db.prepare("SELECT count(*) as count FROM sub_contacts WHERE parent_contact_id = ?").get(id);
    
    if (islemSayisi.count === 0 && altMusteriSayisi.count === 0) {
        db.prepare("DELETE FROM contacts WHERE id = ?").run(id);
    }
    res.redirect('/cariler');
});

app.post('/alt-musteri-kaydet', (req, res) => {
    const { parent_contact_id, ad_soyad, arac_plaka, telefon } = req.body;
    db.prepare(`
        INSERT INTO sub_contacts (parent_contact_id, ad_soyad, arac_plaka, telefon)
        VALUES (?, ?, ?, ?)
    `).run(parent_contact_id, ad_soyad, arac_plaka, telefon);
    res.redirect('/alt-musteriler');
});

app.post('/alt-musteri-guncelle', (req, res) => {
    const { id, parent_contact_id, ad_soyad, arac_plaka, telefon } = req.body;
    db.prepare(`
        UPDATE sub_contacts SET parent_contact_id = ?, ad_soyad = ?, arac_plaka = ?, telefon = ?
        WHERE id = ?
    `).run(parent_contact_id, ad_soyad, arac_plaka, telefon, id);
    res.redirect('/alt-musteriler');
});

app.get('/alt-musteri-sil/:id', (req, res) => {
    const id = req.params.id;
    const islemSayisi = db.prepare("SELECT count(*) as count FROM transactions WHERE sub_contact_id = ?").get(id);
    if (islemSayisi.count === 0) {
        db.prepare("DELETE FROM sub_contacts WHERE id = ?").run(id);
    }
    res.redirect('/alt-musteriler');
});

// --- API ---

app.get('/api/alt-musteriler/:id', (req, res) => {
    try {
        const altMusteriler = db.prepare("SELECT * FROM sub_contacts WHERE parent_contact_id = ? ORDER BY ad_soyad").all(req.params.id);
        res.json(altMusteriler);
    } catch (error) {
        res.status(500).json({ error: "Alt müşteriler getirilemedi" });
    }
});

app.get('/api/istatistikler', (req, res) => {
    try {
        const cariSayisi = db.prepare('SELECT count(*) as count FROM contacts').get().count;
        const islemSayisi = db.prepare('SELECT count(*) as count FROM transactions').get().count;
        res.json({ cariSayisi, islemSayisi });
    } catch (error) {
        res.status(500).json({ error: "Hata" });
    }
});
const mongoose = require('mongoose');

// MongoDB Atlas Bağlantısı (Render'da environment variable'dan alacak)
mongoose.connect(process.env.MONGODB_URI, { 
  useNewUrlParser: true, 
  useUnifiedTopology: true 
})
.then(() => console.log('MongoDB Atlas Bağlandı'))
.catch(err => console.log('MongoDB Bağlantı Hatası:', err));
const port = process.env.PORT || 3100;   // Render 10000 verirse onu kullanır, yoksa 3100

app.listen(port, '0.0.0.0', () => {
    console.log(`Sunucu çalışıyor: http://0.0.0.0:${port}`);
});


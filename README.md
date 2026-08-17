# AI Key Manager 🔐

Backend آمن لإدارة مفاتيح AI وتوزيعها على تطبيقات Android.

## المميزات

- ✅ **حماية المفاتيح**: المفاتيح مخزنة في Firebase وليست في التطبيق
- ✅ **Rotation تلقائي**: استخدام المفتاح الأقل استخداماً
- ✅ **Rate Limiting**: حد يومي لكل تطبيق
- ✅ **دعم متعدد**: OpenAI, Gemini, Groq
- ✅ **أتمتة**: تحديث المفاتيح عبر GitHub Actions

## الهيكل

```
ai-key-manager/
├── api/
│   ├── _firebase.js      # إعداد Firebase Admin
│   ├── ask.js            # نقطة النهاية للتطبيق (POST /api/ask)
│   └── keys.js           # إدارة المفاتيح (GET/POST /api/keys)
├── scripts/
│   └── fetch-keys.js     # أتمتة جلب المفاتيح الجديدة
├── .github/workflows/
│   └── update-keys.yml   # GitHub Actions - تحديث يومي
└── vercel.json           # إعداد Vercel
```

## التثبيت

### 1. Firebase Setup

1. أنشئ مشروع في [Firebase Console](https://console.firebase.google.com)
2. فعل **Firestore Database** (اختار test mode مؤقتاً)
3. اذهب إلى Project Settings → Service Accounts
4. اضغط **Generate new private key** → حمل ملف JSON
5. احفظ محتوى الملف في متغير البيئة `FIREBASE_SERVICE_ACCOUNT`

### 2. إنشاء Collections في Firestore

**Collection: `allowed_apps`**
```json
{
  "active": true,
  "appName": "My Android App",
  "dailyLimit": 100,
  "createdAt": timestamp
}
```

**Collection: `api_keys`**
```json
{
  "key": "sk-xxxxxxxx",
  "provider": "openai",
  "model": "gpt-3.5-turbo",
  "active": true,
  "expiresAt": timestamp,
  "lastUsed": timestamp,
  "useCount": 0,
  "dailyLimit": 100
}
```

### 3. النشر على Vercel

```bash
# تثبيت Vercel CLI
npm i -g vercel

# تسجيل الدخول
vercel login

# نسخ المستودع
git clone <repo-url>
cd ai-key-manager
npm install

# إضافة متغير البيئة
vercel env add FIREBASE_SERVICE_ACCOUNT

# النشر
vercel --prod
```

### 4. GitHub Actions

1. اذهب إلى Settings → Secrets and variables → Actions
2. أضف `FIREBASE_SERVICE_ACCOUNT` بقيمة حساب الخدمة
3. GitHub Actions سيعمل تلقائياً يومياً

## API Endpoints

### `POST /api/ask`

النقطة الرئيسية للتطبيق Android.

**Request:**
```json
{
  "message": "اكتب لي كود بلوتو كوتلين",
  "appId": "your-app-id-from-firestore"
}
```

**Response:**
```json
{
  "success": true,
  "reply": "إليك الكود...",
  "model": "gpt-3.5-turbo",
  "provider": "openai",
  "timestamp": "2026-08-17T08:30:00.000Z"
}
```

### `GET /api/keys`

جلب قائمة المفاتيح (بدون إظهار المفتاح كاملاً).

### `POST /api/keys`

إضافة مفتاح جديد.

**Request:**
```json
{
  "key": "sk-xxxx",
  "provider": "openai",
  "model": "gpt-4",
  "expiresAt": "2026-09-17T00:00:00Z"
}
```

## تكامل مع Android (Kotlin)


```kotlin
// Retrofit Interface
interface AiApi {
    @POST("api/ask")
    suspend fun askAi(@Body request: AskRequest): Response<AskResponse>
}

// Usage
val response = AiService.askAi(
    AskRequest(
        message = "اكتب لي دالة لحساب الفيبوناتشي",
        appId = "your-firestore-app-id"
    )
)
```

## الأمان

| الميزة | الوصف |
|--------|-------|
| المفاتيح في Backend | لا تُخزن أبداً في التطبيق |
| App ID Validation | كل تطبيق له معرف فريد |
| Rate Limiting | حد يومي قابل للتعديل |
| Key Rotation | استخدام المفتاح الأقل استخداماً |
| Expired Key Deactivation | تعطيل تلقائي للمفاتيح المنتهية |

## License

MIT
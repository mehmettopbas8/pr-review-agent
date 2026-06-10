# LeadBot — Feature Design Document

Bu doküman henüz implement edilmemiş planlanan özelliklerin tasarımını açıklar.

---

## Modül Sistemi

LeadBot birden fazla modu destekler. Her mod bağımsız açılıp kapatılabilir.

### Konfigürasyon (.env)

```env
# Global default — hangi modüller aktif
ENABLE_PR_REVIEW=true
ENABLE_SPEC_GEN=true
ENABLE_ISSUE_PUSH=true
```

### Label Override

GitHub label'ları `.env` default'larını override eder. Böylece sunucuyu yeniden başlatmadan PR bazında mod seçimi yapılabilir.

| Label | Etki |
|---|---|
| `leadbot:review-only` | Sadece PR review çalışır, spec/issue üretimi atlanır |
| `leadbot:spec-gen` | Requirements dosyası varsa spec + issue script üretilir |
| `leadbot:skip` | LeadBot bu PR'ı tamamen atlar |

**Öncelik sırası:** Label > `.env` flag > default (açık)

---

## Modül 1 — PR Review (mevcut)

Detaylar ana README'de. Kısaca:
- Her push'ta diff'i AI'a gönderir
- Severity bazlı yorum atar (Critical → Low, TODO before merge)
- Merge commit'te uyarı verir
- Merge sonrası retrospective + follow-up issue açar

---

## Modül 2 — Spec Generation

### Tetikleyici

PR açılırken veya güncellenirken aşağıdaki dosyalardan biri diff'te varsa mod devreye girer:

```
requirements.md
requirements.txt
REQUIREMENTS.md
docs/requirements.md
```

Alternatif: PR body'de `<!-- leadbot:spec-gen -->` tag'i bulunuyorsa da tetiklenir.

### Girdi Formatı (requirements dosyası)

Serbest formatlı Türkçe veya İngilizce metin yeterli. Örnek:

```
Kullanıcı kayıt ve giriş yapabilmeli.
JWT token ile kimlik doğrulama olmalı.
Admin kullanıcılar tüm kullanıcıları listeleyebilmeli.
Kullanıcı kendi profilini güncelleyebilmeli.
Şifre sıfırlama e-posta ile yapılmalı.
```

### Çıktı 1 — api-spec.yaml

OpenAPI 3.0 formatında YAML dosyası. AI tarafından üretilir. Örnek yapı:

```yaml
openapi: 3.0.0
info:
  title: Generated API Spec
  version: 1.0.0
paths:
  /auth/register:
    post:
      summary: Register a new user
      ...
  /auth/login:
    post:
      summary: Login and receive JWT
      ...
```

### Çıktı 2 — issues.md

Her endpoint veya feature için bir issue bloğu. Örnek format:

```markdown
## Issue: POST /auth/register — User Registration
**Labels:** backend, auth
**Estimated effort:** S

Implement the user registration endpoint. Should accept email + password,
validate input, hash the password, and return a JWT.

Acceptance criteria:
- [ ] Input validation (email format, password length)
- [ ] Password hashing (bcrypt)
- [ ] Duplicate email check
- [ ] Returns 201 + JWT on success

---

## Issue: POST /auth/login — User Login
**Labels:** backend, auth
**Estimated effort:** S
...
```

### Nereye Gönderilir

Her iki dosya da PR'a **review comment** olarak eklenir — birer kod bloğu halinde. Kullanıcı inceleyip onayladıktan sonra Modül 3 ile issue'lara dönüştürülür.

---

## Modül 3 — Issue Push

### Tetikleyici

PR'a aşağıdaki comment atılınca devreye girer:

```
/leadbot push-issues
```

Opsiyonel olarak hedef repo belirtilebilir:

```
/leadbot push-issues owner/repo
```

Hedef repo belirtilmezse PR'ın kendi reposu kullanılır.

### Akış

1. O PR'daki bot yorumlarını tara — en son `issues.md` bloğunu bul
2. `## Issue:` başlıklarına göre parçalara böl
3. Her parça için GitHub issue aç:
   - **Title:** `## Issue:` satırından
   - **Body:** altındaki açıklama + acceptance criteria
   - **Labels:** `**Labels:**` satırından parse edilir (yoksa `leadbot-generated` eklenir)
   - **Assignee:** PR sahibi (opsiyonel, `.env` ile kapatılabilir)
4. Tüm issue'lar açıldıktan sonra PR'a özet yorum at:
   ```
   ✅ 6 issue opened on owner/repo:
   - #101 POST /auth/register
   - #102 POST /auth/login
   ...
   ```

### Cross-Repo Desteği

Hedef repo farklıysa GitHub App'in o repoya da kurulu olması gerekir.
`.env`'de default hedef repo tanımlanabilir:

```env
DEFAULT_ISSUE_REPO=my-org/backend
```

---

## Özet Akış Diyagramı

```
requirements.md PR'a eklendi
        │
        ▼
LeadBot tetiklenir (spec-gen modu)
        │
        ├─ AI → api-spec.yaml üretir
        ├─ AI → issues.md üretir
        └─ PR'a comment olarak gönderir

Kullanıcı inceleyip onaylar
        │
        ▼
PR'a yorum: /leadbot push-issues [owner/repo]
        │
        ▼
issues.md parse edilir
        │
        └─ Her issue için GitHub issue açılır → özet comment
```

---

## Sonraki Adımlar

1. `specService.js` — requirements → YAML + issues.md üretimi (AI prompt)
2. `issueService.js` — issues.md parse + GitHub issue açma
3. `index.js` — yeni event'ler: requirements dosyası diff'te mi? `/leadbot` comment'i var mı?
4. Label sistemi — webhook'ta label'ları okuyup mod seçimi

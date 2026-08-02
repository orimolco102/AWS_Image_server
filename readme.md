# Cloud Storage Class — תיעוד פרויקט

מערכת להעלאת תמונות לאחסון בענן, בנויה על Node.js/Express, רצה כ-container ב-ECS Fargate מאחורי Load Balancer, עם קובץ CI/CD אוטומטי ב-GitHub Actions.

---

## איך המערכת בנויה

הארכיטקטורה בנויה במבנה תלת-שכבתי (3-tier) בתוך VPC ייעודי:

```
משתמש (דפדפן)
      │
      ▼
Application Load Balancer (Public Subnets, 2 Availability Zones)
      │
      ▼
ECS Fargate Service — קונטיינר Node.js/Express (App Subnets, פרטיים)
      │
      ▼
Amazon S3 (bucket: ori-aws-nodejs)
```

**רכיבי הרשת (VPC):**
- VPC ייעודי עם 2 Availability Zones (`eu-central-1a`, `eu-central-1b`)
- בכל Zone: **Public Subnet** (ל-ALB), **App Subnet** (ל-ECS, פרטי), **Data Subnet** (שמור לעתיד, לא בשימוש כרגע)
- **Internet Gateway** — מאפשר גישה מהאינטרנט ל-Public Subnets
- **NAT Gateway** — מאפשר ל-App Subnets (הפרטיים) לצאת החוצה (למשל למשוך image מ-ECR) בלי להיות חשופים ישירות לאינטרנט

**זרימת הבקשה:**
1. משתמש ניגש לכתובת ה-DNS של ה-ALB
2. ה-ALB (ב-Public Subnets) מקבל את הבקשה בפורט 80, ומעביר אותה ל-Target Group
3. ה-Target Group מנתב לקונטיינר הרץ ב-ECS (App Subnets) בפורט 3000
4. האפליקציה מטפלת בבקשה — מגישה את הדף הראשי, או מעלה קובץ ל-S3 בבקשת `/upload`

**אבטחת רשת (Security Groups) — עקרון "שרשרת אמון":**
- `sg-alb` — מקבל תעבורה מהאינטרנט (80/443)
- `sg-app` — מקבל תעבורה **רק** מ-`sg-alb` (פורט 3000), לא מהאינטרנט ישירות

כך גם אם מישהו מוצא את ה-IP הפרטי של הקונטיינר, הוא לא יכול לגשת אליו ישירות — רק דרך ה-ALB.

---

## באילו שירותי AWS השתמשנו

| שירות | תפקיד |
|---|---|
| **Amazon ECS (Fargate)** | מריץ את קונטיינר האפליקציה, ללא צורך לנהל שרתים (serverless) |
| **Amazon ECR** | Container Registry — שומר את ה-Docker images שנבנים ונדחפים בכל deploy |
| **Application Load Balancer (ALB)** | מפזר תעבורה נכנסת, מבצע health checks, ומהווה נקודת הכניסה היחידה מהאינטרנט |
| **Amazon S3** | אחסון קבצים שהועלו על ידי המשתמשים |
| **Amazon VPC** | רשת פרטית מבודדת עם Subnets ציבוריים ופרטיים |
| **NAT Gateway** | מאפשר גישת אינטרנט יוצאת מה-Subnets הפרטיים |
| **IAM (Roles & Policies)** | ניהול הרשאות — Task Role, Task Execution Role, ו-IAM User ל-CI/CD |
| **CloudWatch Logs** | איסוף לוגים מהקונטיינר לצורך דיבאג |
| **AWS CLI** | ניהול והפעלת פעולות (עדכון service, בדיקת health status וכו') |

---

## איך ה-CI/CD עובד

השתמשנו ב-**GitHub Actions** לבניית pipeline אוטומטי שרץ בכל push ל-branch `main`.

**שלבי ה-pipeline (`.github/workflows/deploy.yml`):**

1. **Checkout** — משיכת הקוד העדכני מה-repo
2. **התחברות ל-AWS** — אימות מול AWS דרך access keys השמורים כ-GitHub Secrets
3. **התחברות ל-ECR** — login לרג'יסטרי הקונטיינרים
4. **חישוב מספר גרסה עולה** — סקריפט Bash שבודק את כל ה-tags הקיימים ב-ECR בפורמט `v<מספר>`, מוצא את המספר הגבוה ביותר, ומחשב את הבא בתור (למשל אם קיים `v5`, הבנייה הבאה תתויג `v6`)
5. **Build & Push** — בניית ה-Docker image מחדש (`--no-cache` כדי להבטיח שאין שכבות ישנות/מיושנות), ודחיפה ל-ECR עם התג החדש
6. **עדכון Task Definition** — הורדת ה-task definition הנוכחי מ-ECS, עדכון שדה ה-image בלבד לכתובת החדשה, ורישום כ-revision חדש
7. **פריסה (Deploy)** — עדכון ה-ECS Service להשתמש ב-revision החדש, עם `wait-for-service-stability: true` שגורם ל-pipeline להמתין בפועל עד שהקונטיינר החדש עלה ועבר health check בהצלחה — כך שאם הקוד החדש קורס, ה-pipeline עצמו נכשל ומתריע, במקום "להצליח" באופן מטעה

**מדוע תיוג עולה (`v1`, `v2`, `v3`...) ולא תג קבוע (`prod`)?**
ב-ECR הפעלנו **Image Tag Immutability**, כלומר לא ניתן לדרוס תג קיים. זה מונע מצב שבו תג `prod` "מתחלף בשקט" בלי תיעוד — כל deploy מקבל תג ייחודי, מה שמאפשר rollback מדויק לגרסה ספציפית במידת הצורך.

---

## איך טיפלנו בהרשאות

עבדנו לפי עקרון **הרשאה מינימלית נדרשת** (least privilege), עם הפרדה בין שלושה סוגי הרשאות שונים לגמרי:

### 1. Task Role — הרשאות האפליקציה בזמן ריצה
תפקידו לתת לקוד עצמו (בתוך הקונטיינר) גישה ל-S3, **בלי** להשתמש ב-Access Key/Secret Key קבועים בקוד. במקום זאת:
- נוצר **IAM Role** ייעודי (`cloud-storage-task-role`) עם policy שמאפשרת רק `s3:PutObject` ו-`s3:GetObject`, ורק על ה-bucket הספציפי שלנו
- ה-role מחובר ל-Task Definition, ו-AWS SDK מזהה את ההרשאות אוטומטית דרך ה-metadata endpoint של ECS — בלי לשמור סודות בקוד או ב-Dockerfile

### 2. Task Execution Role
role נפרד (`ecsTaskExecutionRole`) שאחראי על דברים תשתיתיים — משיכת ה-image מ-ECR וכתיבת לוגים ל-CloudWatch. זה **לא** אותו role כמו ה-Task Role, כי יש הפרדה בין "מה שה-container platform צריך" לבין "מה שהאפליקציה שלי צריכה".

### 3. IAM User ל-CI/CD (GitHub Actions)
נוצר משתמש ייעודי (`github-actions-deploy`) עם access keys שנשמרו כ-**GitHub Secrets** (לא בקוד, לא ב-repo). ההרשאות שלו מוגבלות בדיוק לפעולות הנדרשות ל-pipeline:
- דחיפת images ל-ECR הספציפי בלבד
- עדכון ה-ECS Service ורישום Task Definition חדש
- `iam:PassRole` מוגבל אך ורק ל-two ה-roles הרלוונטיים (Task Role ו-Execution Role) — כדי שה-pipeline יוכל "למסור" אותם ל-ECS בלי הרשאות רחבות יותר

**עקרון מרכזי:** בשום שלב לא השתמשנו ב-Access Key/Secret Key קבועים בתוך קוד האפליקציה עצמה — הכל דרך IAM Roles שמתחלפים ומנוהלים על ידי AWS.

---

## בעיה שנתקלנו בה ואיך פתרנו אותה

**הבעיה:** לאחר שהאפליקציה עלתה בהצלחה על ECS מאחורי ה-ALB, ניסיון להעלות קובץ נכשל עם שגיאת **CORS** בדפדפן:
```
Cross-Origin Request Blocked: ... 'Access-Control-Allow-Origin' missing
```
ובנוסף — שגיאת `NetworkError` כללית.

**תהליך האבחון:**
1. בהתחלה נראה כמו בעיית תצורת CORS בשרת
2. בבדיקה מדוקדקת יותר התגלה שהבעיה עמוקה יותר: קוד ה-frontend (`script.js`) היה מקודד עם כתובת קבועה — `http://127.0.0.1:3000/upload` — שהתאימה לסביבת הפיתוח המקומית בלבד. כשהאפליקציה עלתה בפועל דרך ה-ALB, הדפדפן של המשתמש ניסה לפנות ל-`127.0.0.1` **של המחשב שלו עצמו**, ולא לשרת האמיתי — מה שגרם לכשל
3. לאחר תיקון הקריאה לנתיב יחסי (`/upload` במקום כתובת מוחלטת), התגלתה שגיאה נוספת: השרת עצמו זרק `Error: origin not allowed` — כי רשימת ה-origins המורשים ב-CORS middleware כללה רק את כתובת הפיתוח המקומי, ולא את כתובת ה-ALB בפועל
4. אבחון השגיאה בוצע דרך **CloudWatch Logs**, שם נראה ה-stack trace המדויק שהצביע ישירות על ה-middleware של CORS כמקור הבעיה

**הפתרון:**
- עדכון קריאת ה-`fetch` ב-frontend לנתיב יחסי (`/upload`) במקום כתובת מוחלטת — כך הבקשה תמיד נשלחת לאותו domain שממנו הוגש הדף, בכל סביבה
- הוספת כתובת ה-ALB בפועל לרשימת ה-`allowedOrigin` בקונפיגורציית ה-CORS בשרת
- הוספת **error-handling middleware** גלובלי ב-Express, כדי שבמקרה של שגיאה (כמו CORS) השרת יחזיר JSON קריא במקום דף שגיאה גולמי ב-HTML — מה שהפך את האבחון הבא להרבה יותר קל

**לקח מרכזי:** קוד frontend שמכיל כתובות מקודדות (`hardcoded`) לסביבת פיתוח מקומית חייב להתאים אוטומטית לסביבת production — פתרון נכון הוא שימוש בנתיבים יחסיים, כך שהקוד "עובד בכל מקום" בלי צורך בשינוי ידני בין סביבות.
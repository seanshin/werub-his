# Hospital RUN — 프로덕션 배포 가이드

> 🔴 **현재 운영 인스턴스(`his.example.org`)는 이 문서의 방식으로 돌지 않는다**(2026-08-25 실측).
> 실제 배포는 `infra/scripts/deploy.sh` 의 **작업 트리 rsync + 서버 빌드 + pm2** 이고,
> 이 문서가 전제하는 `/opt/hospital-run` 경로와 `docker-compose.prod.yml` 컨테이너 스택은 서버에 없다
> (`.github/workflows/deploy.yml` 도 같은 전제라 지금 실행하면 실패한다).
> 이 문서는 **다른 사이트에 docker-compose 로 새로 세울 때의 참조**로 남긴다.

## 1. 서버 요구사항

| 항목 | 최소 | 권장 |
|------|------|------|
| CPU | 4 cores | 8 cores |
| RAM | 8 GB | 16 GB |
| Storage | 50 GB SSD | 200 GB SSD |
| OS | Ubuntu 22.04+ | Ubuntu 24.04 LTS |
| Docker | 24.0+ | latest |
| Docker Compose | v2.20+ | latest |

## 2. 서버 초기 설정

```bash
# 1. Docker 설치
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 2. 프로젝트 클론
cd /opt
git clone https://github.com/your-org/hospital-run.git
cd hospital-run

# 3. SSL 인증서 배치
mkdir -p infra/docker/nginx/ssl
# Let's Encrypt 또는 기관 인증서를 아래 경로에 복사:
#   infra/docker/nginx/ssl/fullchain.pem
#   infra/docker/nginx/ssl/privkey.pem

# Let's Encrypt 자동 발급 (certbot):
# sudo certbot certonly --standalone -d his.hospital.kr
# sudo cp /etc/letsencrypt/live/his.hospital.kr/fullchain.pem infra/docker/nginx/ssl/
# sudo cp /etc/letsencrypt/live/his.hospital.kr/privkey.pem infra/docker/nginx/ssl/
```

## 3. 환경변수 설정

```bash
cd infra/docker
cp .env.production.example .env.production
```

`.env.production` 파일을 편집하여 실제 값 입력:

```bash
# 강력한 비밀번호 생성
openssl rand -base64 32   # DB_PASSWORD, AUTH_SECRET 등에 사용
openssl rand -hex 32      # ENCRYPTION_KEY에 사용 (64자 hex)
```

| 변수 | 설명 | 생성 방법 |
|------|------|----------|
| `DB_PASSWORD` | PostgreSQL 비밀번호 | `openssl rand -base64 32` |
| `REDIS_PASSWORD` | Redis 비밀번호 | `openssl rand -base64 16` |
| `AUTH_SECRET` | JWT Access Token 서명키 | `openssl rand -base64 32` |
| `AUTH_REFRESH_SECRET` | JWT Refresh Token 서명키 | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | AES-256 암호화키 (보험번호 등) | `openssl rand -hex 32` |
| `PUBLIC_URL` | 외부 접속 URL | `https://his.hospital.kr` |

## 4. 배포 실행

```bash
cd /opt/hospital-run/infra/docker

# 빌드 + 마이그레이션 + 시작 (첫 배포)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# 로그 확인
docker compose -f docker-compose.prod.yml logs -f

# 헬스체크
curl -k https://localhost/health
```

### 서비스 시작 순서 (자동)

```
1. PostgreSQL 시작 → healthcheck 통과
2. Redis 시작 → healthcheck 통과
3. migrate 컨테이너 실행 → prisma migrate deploy + seed → 종료
4. API 서버 시작 (x2 replicas) → healthcheck 통과
5. Web 서버 시작 (x2 replicas)
6. Nginx 시작 → 80/443 포트 리스닝
```

## 5. 업데이트 배포

```bash
cd /opt/hospital-run

# 코드 업데이트
git pull origin main

# 빌드 + 무중단 재배포
cd infra/docker
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm migrate
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --remove-orphans

# 헬스체크
sleep 10 && curl -sf https://localhost/health && echo "OK"
```

## 6. 백업 / 복구

### 자동 백업 (crontab)

```bash
# crontab -e 에 추가
# 🔴 **OS crontab 은 UTC 로 돈다**(서버 timezone=Etc/UTC · 2026-08-29 실측).
#    아래 `0 3` 은 **03:00 UTC = KST 정오**다. KST 새벽 3시를 원하면 `0 18` 이다.
#    (NestJS `@Cron` 은 pm2 의 TZ=Asia/Seoul 을 따르므로 같은 표기가 9시간 다르다)
0 3 * * * cd /opt/hospital-run/infra/docker && \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U hospital hospitalrun | gzip > backups/hospitalrun_$(date +\%Y\%m\%d).sql.gz
```

### 수동 백업

```bash
cd /opt/hospital-run/infra/docker
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U hospital hospitalrun > backups/hospitalrun_backup.sql
```

### 복구

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U hospital hospitalrun < backups/hospitalrun_backup.sql
```

## 7. 롤백

```bash
# 이전 버전으로 코드 되돌리기
git log --oneline -5          # 커밋 확인
git checkout <commit-hash>    # 특정 버전으로

# 재빌드 + 재배포
cd infra/docker
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

## 8. 모니터링

### 로그 확인

```bash
# 전체 로그
docker compose -f docker-compose.prod.yml logs -f

# 특정 서비스
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f nginx

# Nginx access log
tail -f infra/docker/nginx/logs/access.log
```

### 서비스 상태

```bash
docker compose -f docker-compose.prod.yml ps
```

### 리소스 사용량

```bash
docker stats
```

## 9. SSL 인증서 갱신

```bash
# Let's Encrypt 자동 갱신 (crontab)
0 0 1 * * certbot renew --quiet && \
  cp /etc/letsencrypt/live/his.hospital.kr/fullchain.pem /opt/hospital-run/infra/docker/nginx/ssl/ && \
  cp /etc/letsencrypt/live/his.hospital.kr/privkey.pem /opt/hospital-run/infra/docker/nginx/ssl/ && \
  docker compose -f /opt/hospital-run/infra/docker/docker-compose.prod.yml restart nginx
```

## 10. 보안 체크리스트

- [ ] `.env.production` 파일이 git에 포함되지 않았는지 확인
- [ ] SSL 인증서 유효기간 확인
- [ ] DB_PASSWORD, AUTH_SECRET 등 모든 시크릿 변경 완료
- [ ] 서버 방화벽: 80, 443만 외부 개방 (5432, 6379 차단)
- [ ] SSH 키 기반 접속만 허용 (비밀번호 로그인 비활성화)
- [ ] Docker 이미지 최신 보안 패치 적용
- [ ] 백업 cron 설정 완료
- [ ] Nginx rate limiting 동작 확인

## 11. GitHub Actions (CI/CD)

### 필요한 Secrets 설정

GitHub Repository → Settings → Secrets and variables → Actions:

| Secret | 값 |
|--------|-----|
| `DEPLOY_HOST` | 서버 IP 또는 도메인 |
| `DEPLOY_USER` | SSH 사용자 (예: deploy) |
| `DEPLOY_SSH_KEY` | SSH 개인키 (Ed25519 권장) |

### CI 자동 실행
- `main`, `develop` 브랜치 push 시 자동 빌드 + 타입체크
- PR 생성 시 자동 검증

### 수동 배포
- GitHub Actions → Deploy Production → Run workflow → 환경 선택 → 실행

## 12. 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| 502 Bad Gateway | API 컨테이너 미시작 | `docker compose logs api` 확인 |
| DB connection refused | PostgreSQL 미시작 | `docker compose ps postgres` 확인 |
| SSL 에러 | 인증서 미배치/만료 | `nginx/ssl/` 파일 확인 |
| migrate 실패 | 스키마 충돌 | `prisma migrate resolve` 실행 |
| 메모리 부족 | 리소스 제한 초과 | `docker stats`로 확인 후 limits 조정 |

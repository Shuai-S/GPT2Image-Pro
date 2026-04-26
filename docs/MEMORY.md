# GPT2IMAGE Pro — 实时关键记忆

## 部署状态

- **用户站**: https://gpt2image.pro (port 3000)
- **管理站**: https://admin.gpt2image.pro (port 3001)
- **服务器**: `ssh free7` (DigitalOcean Ubuntu 24.04, 4vCPU 8GB, Docker 29.4.0)
- **项目路径**: `/root/gpt2image-pro/`
- **数据库**: PostgreSQL on same server (port 8888, container: postgres-moapi)
- **SSL**: Let's Encrypt via Certbot (auto-renew), expires 2026-07-25
- **Nginx**: `/etc/nginx/conf.d/gpt2image-pro.conf`

## Creem 支付沙盒

- **Store ID**: `sto_4VTW4UFib0d0ERbovJb1Cz`
- **API Key**: `creem_test_3byIkzPCnbRESJyApvMqji`
- **API Base**: `https://test-api.creem.io/v1`
- **Webhook Secret**: 未配置

### 产品 ID

| Plan | Monthly | Yearly |
|------|---------|--------|
| Starter ($5/$35) | `prod_6frLk5xZKgStCpyoLKI8Xq` | `prod_4BsNv0KGTmiscJWdFT46PD` |
| Pro ($9/$65) | `prod_2TfhR4ukhC4fyta6AVlvpA` | `prod_21T1xVmhpWtbZPwxjbZRgm` |
| Ultra ($15/$109) | `prod_50QdyZz1uc5t0WU64GK8qM` | `prod_1rjwo6pADwikH1YUzbz31X` |

## R2 存储

- **Endpoint**: `https://cb5d3307349a8fde7637f773906ad340.r2.cloudflarestorage.com`
- **Bucket**: `miaojiang`
- **状态**: 待配置 Access Key

## 待办

- [ ] 配置 R2 存储 Access Key
- [ ] 配置 Creem Webhook Secret
- [ ] 清理根目录旧 `src/` 代码
- [ ] 更新 README.md 为 monorepo 结构
- [ ] 迁移 Next.js 16 middleware 到 proxy convention

## 部署操作

```bash
# 更新部署
scp deploy.tar.gz free7:/root/gpt2image-pro-deploy.tar.gz
ssh free7 "cd /root/gpt2image-pro && tar xzf /root/gpt2image-pro-deploy.tar.gz && docker compose up -d --build"

# 查看日志
ssh free7 "docker logs -f gpt2image-web"
ssh free7 "docker logs -f gpt2image-admin"

# 重启服务
ssh free7 "cd /root/gpt2image-pro && docker compose restart"
```

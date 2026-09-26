@echo off
chcp 65001 >nul
echo ========================================================
echo   KHÔI PHỤC VỀ BẢN CŨ ỔN ĐỊNH (ROLLBACK NHÀ TRỌ APP)
echo ========================================================
echo.
echo Đang hoàn tác toàn bộ thay đổi và đưa app về bản gốc v1.0...
echo.
git reset --hard v1.0-backup-goc
git push --force origin main
echo.
echo ========================================================
echo   ✅ ĐÃ QUAY VỀ BẢN CŨ THÀNH CÔNG 100%!
echo ========================================================
pause

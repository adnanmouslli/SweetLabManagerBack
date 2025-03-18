module.exports = {
    apps: [
      {
        name: 'sweetLabBackend', // اسم التطبيق في PM2
        script: 'dist/src/main.js', // مسار ملف التطبيق المبني (بعد تشغيل npm run build)
        instances: 'max', // استخدام أقصى عدد من النوى المتاحة (يمكنك تغييره إلى رقم محدد)
        exec_mode: 'cluster', // وضع التشغيل (cluster للاستفادة من تعدد النوى)
        autorestart: true, // إعادة التشغيل التلقائي عند حدوث خطأ
        watch: false, // عدم مراقبة التغييرات في الملفات (يمكن تغييره إلى true في بيئة التطوير)
        max_memory_restart: '1G', // إعادة التشغيل إذا تجاوزت الذاكرة 1GB
        env: {
          NODE_ENV: 'production',
          PORT: 4300, // المنفذ الافتراضي
          API_PREFIX: '/', // بادئة API
          CORS_ORIGIN: '*', // سماح CORS من أي مصدر (يمكنك تحديد النطاقات المسموح بها)
        },
        env_development: {
          NODE_ENV: 'development',
          PORT: 3000,
          API_PREFIX: '/api',
          CORS_ORIGIN: '*',
        },
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
        error_file: 'logs/error.log', // ملف تسجيل الأخطاء
        out_file: 'logs/out.log', // ملف تسجيل المخرجات
        merge_logs: true,
        time: true, // إضافة طوابع زمنية للسجلات
      },
    ],
  };
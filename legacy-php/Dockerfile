# The "legacy" PHP app. Real legacy systems often run old PHP on Apache like this.
FROM php:8.3-apache
RUN apt-get update && apt-get install -y libpq-dev && docker-php-ext-install pdo_pgsql && rm -rf /var/lib/apt/lists/*

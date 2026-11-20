-- Tabela de traduções (só se o db-sync do build não criar sozinho). Rode no phpMyAdmin › SQL.
-- ContentTranslation
CREATE TABLE IF NOT EXISTS `ContentTranslation` (
    `id` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(20) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `locale` VARCHAR(8) NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'DONE', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `sourceHash` VARCHAR(64) NOT NULL,
    `title` VARCHAR(255) NULL,
    `description` TEXT NULL,
    `content` MEDIUMTEXT NULL,
    `seoTitle` VARCHAR(255) NULL,
    `seoDescription` VARCHAR(320) NULL,
    `extra` JSON NULL,
    `model` VARCHAR(80) NULL,
    `error` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `manualEdit` BOOLEAN NOT NULL DEFAULT false,
    `reviewedAt` DATETIME(3) NULL,
    `lockedAt` DATETIME(3) NULL,
    `translatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `ContentTranslation_entityType_entityId_locale_key`(`entityType`, `entityId`, `locale`),
    INDEX `ContentTranslation_status_updatedAt_idx`(`status`, `updatedAt`),
    INDEX `ContentTranslation_entityType_locale_status_idx`(`entityType`, `locale`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

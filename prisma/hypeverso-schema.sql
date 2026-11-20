-- Hypeverso — estrutura completa do banco (MySQL 8 / MariaDB 10.6+)
-- Gerado a partir de prisma/schema.prisma. Equivale ao "npx prisma db push" num banco vazio.
-- Como usar: phpMyAdmin > selecione o banco u854301123_hypeverso > aba SQL (ou Importar) > cole/envie este arquivo > Executar.
-- Rode só UMA vez, num banco vazio. Depois disso o "npm run db:sync" cuida das mudanças futuras.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- User
CREATE TABLE IF NOT EXISTS `User` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `avatarUrl` VARCHAR(1024) NULL,
    `bio` VARCHAR(600) NULL,
    `level` INTEGER NOT NULL DEFAULT 1,
    `xp` INTEGER NOT NULL DEFAULT 0,
    `role` ENUM('USER', 'MODERATOR', 'EDITOR', 'ADMIN') NOT NULL DEFAULT 'USER',
    `status` ENUM('ACTIVE', 'SUSPENDED', 'BANNED') NOT NULL DEFAULT 'ACTIVE',
    `emailVerifiedAt` DATETIME(3) NULL,
    `termsAcceptedAt` DATETIME(3) NULL,
    `termsVersion` VARCHAR(191) NULL,
    `totpSecret` VARCHAR(512) NULL,
    `totpPendingSecret` VARCHAR(512) NULL,
    `totpEnabledAt` DATETIME(3) NULL,
    `totpLastStep` INTEGER NULL,
    `totpRecoveryCodes` JSON NULL,
    `moderationReputation` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `User_username_key`(`username`),
    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- RefreshToken
CREATE TABLE IF NOT EXISTS `RefreshToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `mfaVerified` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `RefreshToken_tokenHash_key`(`tokenHash`),
    INDEX `RefreshToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- EmailVerificationToken
CREATE TABLE IF NOT EXISTS `EmailVerificationToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `EmailVerificationToken_tokenHash_key`(`tokenHash`),
    INDEX `EmailVerificationToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- PasswordResetToken
CREATE TABLE IF NOT EXISTS `PasswordResetToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `PasswordResetToken_tokenHash_key`(`tokenHash`),
    INDEX `PasswordResetToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Category
CREATE TABLE IF NOT EXISTS `Category` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` VARCHAR(500) NULL,
    `icon` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `Category_name_key`(`name`),
    UNIQUE INDEX `Category_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Tag
CREATE TABLE IF NOT EXISTS `Tag` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    UNIQUE INDEX `Tag_name_key`(`name`),
    UNIQUE INDEX `Tag_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Post
CREATE TABLE IF NOT EXISTS `Post` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `content` TEXT NOT NULL,
    `coverImageUrl` VARCHAR(1024) NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `isPremium` BOOLEAN NOT NULL DEFAULT false,
    `seoTitle` VARCHAR(255) NULL,
    `seoDescription` VARCHAR(320) NULL,
    `publishedAt` DATETIME(3) NULL,
    `scheduledAt` DATETIME(3) NULL,
    `viewCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Post_slug_key`(`slug`),
    INDEX `Post_status_publishedAt_idx`(`status`, `publishedAt`),
    INDEX `Post_categoryId_status_idx`(`categoryId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- PostEmbedding
CREATE TABLE IF NOT EXISTS `PostEmbedding` (
    `postId` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `contentHash` VARCHAR(191) NOT NULL,
    `embedding` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `PostEmbedding_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`postId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- PostTag
CREATE TABLE IF NOT EXISTS `PostTag` (
    `postId` VARCHAR(191) NOT NULL,
    `tagId` VARCHAR(191) NOT NULL,
    PRIMARY KEY (`postId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Comment
CREATE TABLE IF NOT EXISTS `Comment` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `content` TEXT NOT NULL,
    `hiddenAt` DATETIME(3) NULL,
    `hiddenReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `Comment_postId_createdAt_idx`(`postId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CommentLike
CREATE TABLE IF NOT EXISTS `CommentLike` (
    `commentId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`commentId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CommentReport
CREATE TABLE IF NOT EXISTS `CommentReport` (
    `id` VARCHAR(191) NOT NULL,
    `commentId` VARCHAR(191) NOT NULL,
    `reporterId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `details` TEXT NULL,
    `status` ENUM('OPEN', 'REVIEWED', 'RESOLVED', 'DISMISSED') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `CommentReport_commentId_reporterId_key`(`commentId`, `reporterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Favorite
CREATE TABLE IF NOT EXISTS `Favorite` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `Favorite_userId_postId_key`(`userId`, `postId`),
    INDEX `Favorite_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- LibraryItem
CREATE TABLE IF NOT EXISTS `LibraryItem` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(512) NOT NULL,
    `mediaType` VARCHAR(191) NOT NULL,
    `coverUrl` VARCHAR(1024) NULL,
    `status` ENUM('WATCHING', 'WANT_TO_WATCH', 'COMPLETED', 'DROPPED', 'READING', 'WANT_TO_READ', 'PLAYING', 'WANT_TO_PLAY') NOT NULL,
    `notes` TEXT NULL,
    `rating` INTEGER NULL,
    `catalogItemId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `LibraryItem_userId_externalId_mediaType_key`(`userId`, `externalId`, `mediaType`),
    INDEX `LibraryItem_userId_status_idx`(`userId`, `status`),
    INDEX `LibraryItem_catalogItemId_idx`(`catalogItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- MediaCatalogItem
CREATE TABLE IF NOT EXISTS `MediaCatalogItem` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `mediaType` VARCHAR(191) NOT NULL,
    `title` VARCHAR(512) NOT NULL,
    `originalTitle` VARCHAR(512) NULL,
    `slug` VARCHAR(512) NOT NULL,
    `description` TEXT NULL,
    `coverUrl` VARCHAR(1024) NULL,
    `backdropUrl` VARCHAR(1024) NULL,
    `releaseDate` DATETIME(3) NULL,
    `genres` JSON NULL,
    `rating` DOUBLE NULL,
    `sourceUrl` VARCHAR(1024) NULL,
    `trailerUrl` VARCHAR(1024) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `MediaCatalogItem_provider_externalId_mediaType_key`(`provider`, `externalId`, `mediaType`),
    INDEX `MediaCatalogItem_mediaType_title_idx`(`mediaType`, `title`),
    INDEX `MediaCatalogItem_releaseDate_idx`(`releaseDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- MediaReleaseReminder
CREATE TABLE IF NOT EXISTS `MediaReleaseReminder` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `catalogItemId` VARCHAR(191) NOT NULL,
    `remindBeforeDays` INTEGER NOT NULL DEFAULT 1,
    `notifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `MediaReleaseReminder_userId_catalogItemId_key`(`userId`, `catalogItemId`),
    INDEX `MediaReleaseReminder_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `MediaReleaseReminder_notifiedAt_catalogItemId_idx`(`notifiedAt`, `catalogItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- UserFollow
CREATE TABLE IF NOT EXISTS `UserFollow` (
    `followerId` VARCHAR(191) NOT NULL,
    `followingId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`followerId`, `followingId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- UserNewsCategoryPreference
CREATE TABLE IF NOT EXISTS `UserNewsCategoryPreference` (
    `userId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `UserNewsCategoryPreference_categoryId_userId_idx`(`categoryId`, `userId`),
    PRIMARY KEY (`userId`, `categoryId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CommunityPost
CREATE TABLE IF NOT EXISTS `CommunityPost` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `imageUrl` VARCHAR(1024) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `CommunityPost_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CommunityComment
CREATE TABLE IF NOT EXISTS `CommunityComment` (
    `id` VARCHAR(191) NOT NULL,
    `communityPostId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `CommunityComment_communityPostId_createdAt_idx`(`communityPostId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CommunityReaction
CREATE TABLE IF NOT EXISTS `CommunityReaction` (
    `communityPostId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'LIKE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`communityPostId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Notification
CREATE TABLE IF NOT EXISTS `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `recipientId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `type` ENUM('FOLLOW', 'COMMENT', 'REPLY', 'REACTION', 'SYSTEM', 'ACHIEVEMENT', 'PREMIUM', 'FOLLOW_ACTIVITY', 'NEWS', 'MEDIA_RELEASE') NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `body` TEXT NULL,
    `entityType` VARCHAR(191) NULL,
    `entityId` VARCHAR(191) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `Notification_recipientId_readAt_createdAt_idx`(`recipientId`, `readAt`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Achievement
CREATE TABLE IF NOT EXISTS `Achievement` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `icon` VARCHAR(191) NULL,
    `xpReward` INTEGER NOT NULL DEFAULT 0,
    UNIQUE INDEX `Achievement_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- UserAchievement
CREATE TABLE IF NOT EXISTS `UserAchievement` (
    `userId` VARCHAR(191) NOT NULL,
    `achievementId` VARCHAR(191) NOT NULL,
    `unlockedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`userId`, `achievementId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- SearchHistory
CREATE TABLE IF NOT EXISTS `SearchHistory` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `query` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `SearchHistory_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- UserInteraction
CREATE TABLE IF NOT EXISTS `UserInteraction` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `weight` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `UserInteraction_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `UserInteraction_postId_type_idx`(`postId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Subscription
CREATE TABLE IF NOT EXISTS `Subscription` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `stripeCustomerId` VARCHAR(191) NULL,
    `stripeSubscriptionId` VARCHAR(191) NULL,
    `status` ENUM('FREE', 'ACTIVE', 'PAST_DUE', 'CANCELED') NOT NULL DEFAULT 'FREE',
    `currentPeriodEnd` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Subscription_userId_key`(`userId`),
    UNIQUE INDEX `Subscription_stripeCustomerId_key`(`stripeCustomerId`),
    UNIQUE INDEX `Subscription_stripeSubscriptionId_key`(`stripeSubscriptionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AnalyticsEvent
CREATE TABLE IF NOT EXISTS `AnalyticsEvent` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `postId` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `path` VARCHAR(512) NULL,
    `referrer` VARCHAR(1024) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `AnalyticsEvent_type_createdAt_idx`(`type`, `createdAt`),
    INDEX `AnalyticsEvent_postId_createdAt_idx`(`postId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AiNewsJob
CREATE TABLE IF NOT EXISTS `AiNewsJob` (
    `id` VARCHAR(191) NOT NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NULL,
    `query` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED') NOT NULL DEFAULT 'PENDING',
    `requestedDrafts` INTEGER NOT NULL DEFAULT 1,
    `createdDrafts` INTEGER NOT NULL DEFAULT 0,
    `language` VARCHAR(191) NOT NULL DEFAULT 'pt-BR',
    `timeRange` VARCHAR(191) NOT NULL DEFAULT 'day',
    `model` VARCHAR(191) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `stage` VARCHAR(191) NOT NULL DEFAULT 'QUEUED',
    `stageMessage` TEXT NULL,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `lastHeartbeatAt` DATETIME(3) NULL,
    `cancelRequestedAt` DATETIME(3) NULL,
    `hiddenAt` DATETIME(3) NULL,
    `error` TEXT NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `AiNewsJob_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `AiNewsJob_status_lastHeartbeatAt_idx`(`status`, `lastHeartbeatAt`),
    INDEX `AiNewsJob_hiddenAt_status_createdAt_idx`(`hiddenAt`, `status`, `createdAt`),
    INDEX `AiNewsJob_requestedById_createdAt_idx`(`requestedById`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AiNewsDraft
CREATE TABLE IF NOT EXISTS `AiNewsDraft` (
    `id` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `topic` VARCHAR(512) NOT NULL,
    `coverImageCredit` VARCHAR(1024) NULL,
    `coverImageSourceUrl` VARCHAR(1024) NULL,
    `inlineImageCredit` VARCHAR(1024) NULL,
    `inlineImageSourceUrl` VARCHAR(1024) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `AiNewsDraft_postId_key`(`postId`),
    INDEX `AiNewsDraft_jobId_createdAt_idx`(`jobId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AiNewsSource
CREATE TABLE IF NOT EXISTS `AiNewsSource` (
    `id` VARCHAR(191) NOT NULL,
    `draftId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(512) NOT NULL,
    `url` VARCHAR(512) NOT NULL,
    `publisher` VARCHAR(191) NULL,
    `excerpt` TEXT NULL,
    `sourcePublishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `AiNewsSource_draftId_url_key`(`draftId`, `url`),
    INDEX `AiNewsSource_url_idx`(`url`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- NewsletterSubscription
CREATE TABLE IF NOT EXISTS `NewsletterSubscription` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `categoryIds` JSON NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'UNSUBSCRIBED') NOT NULL DEFAULT 'PENDING',
    `confirmTokenHash` VARCHAR(191) NULL,
    `confirmTokenExpiresAt` DATETIME(3) NULL,
    `unsubscribeToken` VARCHAR(191) NOT NULL,
    `confirmedAt` DATETIME(3) NULL,
    `unsubscribedAt` DATETIME(3) NULL,
    `lastSentAt` DATETIME(3) NULL,
    `consentIp` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `NewsletterSubscription_email_key`(`email`),
    UNIQUE INDEX `NewsletterSubscription_userId_key`(`userId`),
    UNIQUE INDEX `NewsletterSubscription_confirmTokenHash_key`(`confirmTokenHash`),
    UNIQUE INDEX `NewsletterSubscription_unsubscribeToken_key`(`unsubscribeToken`),
    INDEX `NewsletterSubscription_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- PushSubscription
CREATE TABLE IF NOT EXISTS `PushSubscription` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `endpoint` VARCHAR(512) NOT NULL,
    `p256dh` VARCHAR(255) NOT NULL,
    `auth` VARCHAR(255) NOT NULL,
    `topics` JSON NULL,
    `userAgent` VARCHAR(512) NULL,
    `failures` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,
    UNIQUE INDEX `PushSubscription_endpoint_key`(`endpoint`),
    INDEX `PushSubscription_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CatalogReview
CREATE TABLE IF NOT EXISTS `CatalogReview` (
    `id` VARCHAR(191) NOT NULL,
    `catalogItemId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `rating` INTEGER NOT NULL,
    `title` VARCHAR(120) NULL,
    `body` TEXT NULL,
    `spoiler` BOOLEAN NOT NULL DEFAULT false,
    `hiddenAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `CatalogReview_catalogItemId_userId_key`(`catalogItemId`, `userId`),
    INDEX `CatalogReview_catalogItemId_createdAt_idx`(`catalogItemId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- DiscussionThread
CREATE TABLE IF NOT EXISTS `DiscussionThread` (
    `id` VARCHAR(191) NOT NULL,
    `catalogItemId` VARCHAR(191) NULL,
    `kind` ENUM('EPISODE', 'WATCH_PARTY', 'GENERAL') NOT NULL DEFAULT 'GENERAL',
    `title` VARCHAR(160) NOT NULL,
    `description` TEXT NULL,
    `season` INTEGER NULL,
    `episode` INTEGER NULL,
    `startsAt` DATETIME(3) NULL,
    `lockedAt` DATETIME(3) NULL,
    `lastMessageAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `DiscussionThread_catalogItemId_createdAt_idx`(`catalogItemId`, `createdAt`),
    INDEX `DiscussionThread_kind_startsAt_idx`(`kind`, `startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ThreadMessage
CREATE TABLE IF NOT EXISTS `ThreadMessage` (
    `id` VARCHAR(191) NOT NULL,
    `threadId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `spoiler` BOOLEAN NOT NULL DEFAULT false,
    `hiddenAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `ThreadMessage_threadId_createdAt_idx`(`threadId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- UserList
CREATE TABLE IF NOT EXISTS `UserList` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `isPublic` BOOLEAN NOT NULL DEFAULT true,
    `viewCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `UserList_userId_slug_key`(`userId`, `slug`),
    INDEX `UserList_isPublic_updatedAt_idx`(`isPublic`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- UserListItem
CREATE TABLE IF NOT EXISTS `UserListItem` (
    `id` VARCHAR(191) NOT NULL,
    `listId` VARCHAR(191) NOT NULL,
    `catalogItemId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `note` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `UserListItem_listId_catalogItemId_key`(`listId`, `catalogItemId`),
    INDEX `UserListItem_listId_position_idx`(`listId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ReportVote
CREATE TABLE IF NOT EXISTS `ReportVote` (
    `id` VARCHAR(191) NOT NULL,
    `reportId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `verdict` ENUM('VIOLATES', 'OK') NOT NULL,
    `weight` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `ReportVote_reportId_userId_key`(`reportId`, `userId`),
    INDEX `ReportVote_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ShopProduct
CREATE TABLE IF NOT EXISTS `ShopProduct` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `imageUrl` VARCHAR(1024) NULL,
    `affiliateUrl` VARCHAR(2048) NOT NULL,
    `store` VARCHAR(191) NOT NULL DEFAULT 'Loja parceira',
    `category` VARCHAR(191) NULL,
    `badge` VARCHAR(191) NULL,
    `priceCents` INTEGER NULL,
    `originalPriceCents` INTEGER NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'BRL',
    `couponCode` VARCHAR(191) NULL,
    `highlights` JSON NULL,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `clicks` INTEGER NOT NULL DEFAULT 0,
    `lastClickedAt` DATETIME(3) NULL,
    `checkStatus` ENUM('UNCHECKED', 'OK', 'PRICE_CHANGED', 'OUT_OF_STOCK', 'BROKEN', 'BLOCKED') NOT NULL DEFAULT 'UNCHECKED',
    `checkMessage` VARCHAR(500) NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `priceUpdatedAt` DATETIME(3) NULL,
    `checkFailures` INTEGER NOT NULL DEFAULT 0,
    `autoHidden` BOOLEAN NOT NULL DEFAULT false,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `ShopProduct_slug_key`(`slug`),
    INDEX `ShopProduct_active_featured_sortOrder_idx`(`active`, `featured`, `sortOrder`),
    INDEX `ShopProduct_checkStatus_lastCheckedAt_idx`(`checkStatus`, `lastCheckedAt`),
    INDEX `ShopProduct_category_idx`(`category`),
    INDEX `ShopProduct_store_idx`(`store`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ShopPriceHistory
CREATE TABLE IF NOT EXISTS `ShopPriceHistory` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `priceCents` INTEGER NULL,
    `originalPriceCents` INTEGER NULL,
    `available` BOOLEAN NOT NULL DEFAULT true,
    `checkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `ShopPriceHistory_productId_checkedAt_idx`(`productId`, `checkedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ShopCollection
CREATE TABLE IF NOT EXISTS `ShopCollection` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `emoji` VARCHAR(16) NULL,
    `category` VARCHAR(191) NULL,
    `store` VARCHAR(191) NULL,
    `maxPriceCents` INTEGER NULL,
    `onlyDiscount` BOOLEAN NOT NULL DEFAULT false,
    `productIds` JSON NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `showOnShop` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `ShopCollection_slug_key`(`slug`),
    INDEX `ShopCollection_active_sortOrder_idx`(`active`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- MediaAsset
CREATE TABLE IF NOT EXISTS `MediaAsset` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `bytes` INTEGER NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `purpose` VARCHAR(40) NOT NULL DEFAULT 'article',
    `data` MEDIUMBLOB NOT NULL,
    `moderationStatus` ENUM('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'NOT_REQUIRED',
    `moderationScore` DOUBLE NULL,
    `moderatedAt` DATETIME(3) NULL,
    `uploadedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `MediaAsset_name_key`(`name`),
    INDEX `MediaAsset_purpose_createdAt_idx`(`purpose`, `createdAt`),
    INDEX `MediaAsset_moderationStatus_createdAt_idx`(`moderationStatus`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- SiteSetting
CREATE TABLE IF NOT EXISTS `SiteSetting` (
    `key` VARCHAR(100) NOT NULL,
    `value` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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


-- Chaves estrangeiras
ALTER TABLE `RefreshToken` ADD CONSTRAINT `RefreshToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `EmailVerificationToken` ADD CONSTRAINT `EmailVerificationToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PasswordResetToken` ADD CONSTRAINT `PasswordResetToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Post` ADD CONSTRAINT `Post_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Post` ADD CONSTRAINT `Post_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PostEmbedding` ADD CONSTRAINT `PostEmbedding_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PostTag` ADD CONSTRAINT `PostTag_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PostTag` ADD CONSTRAINT `PostTag_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `Tag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Comment` ADD CONSTRAINT `Comment_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Comment` ADD CONSTRAINT `Comment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Comment` ADD CONSTRAINT `Comment_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Comment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CommentLike` ADD CONSTRAINT `CommentLike_commentId_fkey` FOREIGN KEY (`commentId`) REFERENCES `Comment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CommentLike` ADD CONSTRAINT `CommentLike_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CommentReport` ADD CONSTRAINT `CommentReport_commentId_fkey` FOREIGN KEY (`commentId`) REFERENCES `Comment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CommentReport` ADD CONSTRAINT `CommentReport_reporterId_fkey` FOREIGN KEY (`reporterId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Favorite` ADD CONSTRAINT `Favorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Favorite` ADD CONSTRAINT `Favorite_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LibraryItem` ADD CONSTRAINT `LibraryItem_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LibraryItem` ADD CONSTRAINT `LibraryItem_catalogItemId_fkey` FOREIGN KEY (`catalogItemId`) REFERENCES `MediaCatalogItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MediaReleaseReminder` ADD CONSTRAINT `MediaReleaseReminder_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MediaReleaseReminder` ADD CONSTRAINT `MediaReleaseReminder_catalogItemId_fkey` FOREIGN KEY (`catalogItemId`) REFERENCES `MediaCatalogItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserFollow` ADD CONSTRAINT `UserFollow_followerId_fkey` FOREIGN KEY (`followerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserFollow` ADD CONSTRAINT `UserFollow_followingId_fkey` FOREIGN KEY (`followingId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserNewsCategoryPreference` ADD CONSTRAINT `UserNewsCategoryPreference_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserNewsCategoryPreference` ADD CONSTRAINT `UserNewsCategoryPreference_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CommunityPost` ADD CONSTRAINT `CommunityPost_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CommunityComment` ADD CONSTRAINT `CommunityComment_communityPostId_fkey` FOREIGN KEY (`communityPostId`) REFERENCES `CommunityPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CommunityComment` ADD CONSTRAINT `CommunityComment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CommunityReaction` ADD CONSTRAINT `CommunityReaction_communityPostId_fkey` FOREIGN KEY (`communityPostId`) REFERENCES `CommunityPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CommunityReaction` ADD CONSTRAINT `CommunityReaction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_recipientId_fkey` FOREIGN KEY (`recipientId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `UserAchievement` ADD CONSTRAINT `UserAchievement_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserAchievement` ADD CONSTRAINT `UserAchievement_achievementId_fkey` FOREIGN KEY (`achievementId`) REFERENCES `Achievement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SearchHistory` ADD CONSTRAINT `SearchHistory_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserInteraction` ADD CONSTRAINT `UserInteraction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserInteraction` ADD CONSTRAINT `UserInteraction_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AnalyticsEvent` ADD CONSTRAINT `AnalyticsEvent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `AnalyticsEvent` ADD CONSTRAINT `AnalyticsEvent_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `AiNewsJob` ADD CONSTRAINT `AiNewsJob_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AiNewsJob` ADD CONSTRAINT `AiNewsJob_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `AiNewsDraft` ADD CONSTRAINT `AiNewsDraft_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `AiNewsJob`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AiNewsDraft` ADD CONSTRAINT `AiNewsDraft_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AiNewsSource` ADD CONSTRAINT `AiNewsSource_draftId_fkey` FOREIGN KEY (`draftId`) REFERENCES `AiNewsDraft`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `NewsletterSubscription` ADD CONSTRAINT `NewsletterSubscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `PushSubscription` ADD CONSTRAINT `PushSubscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CatalogReview` ADD CONSTRAINT `CatalogReview_catalogItemId_fkey` FOREIGN KEY (`catalogItemId`) REFERENCES `MediaCatalogItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CatalogReview` ADD CONSTRAINT `CatalogReview_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DiscussionThread` ADD CONSTRAINT `DiscussionThread_catalogItemId_fkey` FOREIGN KEY (`catalogItemId`) REFERENCES `MediaCatalogItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DiscussionThread` ADD CONSTRAINT `DiscussionThread_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ThreadMessage` ADD CONSTRAINT `ThreadMessage_threadId_fkey` FOREIGN KEY (`threadId`) REFERENCES `DiscussionThread`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ThreadMessage` ADD CONSTRAINT `ThreadMessage_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserList` ADD CONSTRAINT `UserList_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserListItem` ADD CONSTRAINT `UserListItem_listId_fkey` FOREIGN KEY (`listId`) REFERENCES `UserList`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserListItem` ADD CONSTRAINT `UserListItem_catalogItemId_fkey` FOREIGN KEY (`catalogItemId`) REFERENCES `MediaCatalogItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ReportVote` ADD CONSTRAINT `ReportVote_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `CommentReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ReportVote` ADD CONSTRAINT `ReportVote_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ShopProduct` ADD CONSTRAINT `ShopProduct_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ShopPriceHistory` ADD CONSTRAINT `ShopPriceHistory_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `ShopProduct`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;

-- Dados iniciais (mesmo conteúdo do prisma/seed.ts)
INSERT IGNORE INTO `Category` (`id`, `name`, `slug`, `description`, `icon`) VALUES
  ('seedcat_cinema', 'Cinema', 'cinema', 'Filmes, bastidores e lançamentos', 'Clapperboard'),
  ('seedcat_series', 'Séries', 'series', 'Séries, streaming e TV', 'Tv'),
  ('seedcat_games', 'Games', 'games', 'Jogos, consoles e eSports', 'Gamepad2'),
  ('seedcat_anime', 'Anime', 'anime', 'Animes e cultura otaku', 'Sparkles'),
  ('seedcat_mangas', 'Mangás', 'mangas', 'Mangás e light novels', 'BookOpen'),
  ('seedcat_hqs', 'HQs', 'hqs', 'Quadrinhos, Marvel, DC e independentes', 'PanelsTopLeft'),
  ('seedcat_tecnologia', 'Tecnologia', 'tecnologia', 'Tecnologia, IA e inovação', 'Cpu'),
  ('seedcat_culturapop', 'Cultura Pop', 'cultura-pop', 'Universo geek e cultura pop', 'Orbit');

INSERT IGNORE INTO `Achievement` (`id`, `code`, `name`, `description`, `icon`, `xpReward`) VALUES
  ('seedach_first_comment', 'FIRST_COMMENT', 'Primeira Voz', 'Publique seu primeiro comentário', 'MessageCircle', 25),
  ('seedach_first_post', 'FIRST_POST', 'Sinal Aberto', 'Publique no feed da comunidade', 'Radio', 40),
  ('seedach_collector', 'COLLECTOR', 'Colecionador', 'Salve 10 conteúdos nos favoritos', 'Bookmark', 75);

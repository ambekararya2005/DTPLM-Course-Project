-- ArtiSoul — complete schema for a fresh (cloud) MySQL database.
--
-- Equivalent to running artisoul_phase1_schema.sql followed by every
-- backend/artisoul_phase*.sql migration (4 → 10) plus the Shops.upi_qr_url
-- column, flattened into final CREATE TABLE statements.
--
-- It does NOT create or USE a database, so it runs against whichever database
-- your connection already points at (TiDB Cloud "test", Aiven "defaultdb",
-- Railway "railway", or one you created yourself). Table names are written in
-- the exact case the backend queries, which matters on Linux-hosted MySQL.
--
--   mysql --ssl-mode=REQUIRED -h <host> -P <port> -u <user> -p <database> < database/artisoul_full_schema.sql

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS Users (
  user_id    INT AUTO_INCREMENT PRIMARY KEY,
  role       ENUM('artisan', 'customer') NOT NULL,
  name       VARCHAR(100) NOT NULL,
  phone      VARCHAR(15)  NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,              -- bcrypt hash, never plaintext
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Shops ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS Shops (
  shop_id    INT AUTO_INCREMENT PRIMARY KEY,
  artisan_id INT NOT NULL,
  shop_name  VARCHAR(150) NOT NULL,
  latitude   DECIMAL(10, 8) NOT NULL,
  longitude  DECIMAL(11, 8) NOT NULL,
  address    VARCHAR(255),
  upi_qr_url VARCHAR(500) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (artisan_id) REFERENCES Users(user_id) ON DELETE CASCADE,
  INDEX idx_shops_location (latitude, longitude)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Products ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS Products (
  product_id      INT AUTO_INCREMENT PRIMARY KEY,
  shop_id         INT NOT NULL,
  name            VARCHAR(150) NOT NULL,
  price           DECIMAL(10, 2) NOT NULL,
  category        VARCHAR(100),
  image_url       VARCHAR(500),
  description     TEXT,
  stock_status    ENUM('in_stock', 'out_of_stock') DEFAULT 'in_stock',
  stock_quantity  INT NOT NULL DEFAULT 0,          -- phase 10
  view360_enabled TINYINT(1) NOT NULL DEFAULT 0,   -- phase 8
  model_url       VARCHAR(500) NULL,               -- phase 9 (.glb)
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_id) REFERENCES Shops(shop_id) ON DELETE CASCADE,
  INDEX idx_products_shop (shop_id),
  INDEX idx_products_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Orders (phase 4 + phase 6 payments) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS Orders (
  order_id            INT AUTO_INCREMENT PRIMARY KEY,
  customer_id         INT NOT NULL,
  product_id          INT NOT NULL,
  shop_id             INT NOT NULL,
  quantity            INT NOT NULL DEFAULT 1,
  price_at_purchase   DECIMAL(10, 2) NOT NULL,
  status              ENUM('Pending', 'Delivered', 'Cancelled') DEFAULT 'Pending',
  payment_method      ENUM('COD', 'UPI') NOT NULL DEFAULT 'COD',
  payment_status      ENUM('Pending', 'Paid', 'Failed') NOT NULL DEFAULT 'Pending',
  delivery_name       VARCHAR(120) NULL,
  delivery_phone      VARCHAR(20)  NULL,
  delivery_address    VARCHAR(500) NULL,
  razorpay_order_id   VARCHAR(64)  NULL,
  razorpay_payment_id VARCHAR(64)  NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES Users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id)  REFERENCES Products(product_id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id)     REFERENCES Shops(shop_id) ON DELETE CASCADE,
  INDEX idx_orders_customer (customer_id),
  INDEX idx_orders_status (status),
  INDEX idx_orders_shop (shop_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Chat (phase 5) ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ChatConversations (
  conversation_id INT NOT NULL AUTO_INCREMENT,
  shop_id         INT NOT NULL,
  customer_id     INT NOT NULL,
  artisan_id      INT NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id),
  UNIQUE KEY one_customer_per_shop (shop_id, customer_id),
  FOREIGN KEY (shop_id)     REFERENCES Shops(shop_id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES Users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (artisan_id)  REFERENCES Users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ChatMessages (
  message_id      INT NOT NULL AUTO_INCREMENT,
  conversation_id INT NOT NULL,
  sender_id       INT NOT NULL,
  body            TEXT NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id),
  FOREIGN KEY (conversation_id) REFERENCES ChatConversations(conversation_id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id)       REFERENCES Users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Extra product photos / short videos (phase 7) ───────────────────────────
CREATE TABLE IF NOT EXISTS ProductMedia (
  media_id   INT NOT NULL AUTO_INCREMENT,
  product_id INT NOT NULL,
  media_type ENUM('image', 'video') NOT NULL,
  url        VARCHAR(500) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (media_id),
  FOREIGN KEY (product_id) REFERENCES Products(product_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 360° view photos (phase 8) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS Product360 (
  product_id INT NOT NULL,
  angle      ENUM('front', 'right', 'back', 'left', 'top', 'bottom') NOT NULL,
  url        VARCHAR(500) NOT NULL,
  PRIMARY KEY (product_id, angle),
  FOREIGN KEY (product_id) REFERENCES Products(product_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

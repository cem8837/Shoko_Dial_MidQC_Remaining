-- 中檢工管待處理 LOT 自動追蹤與升級通知系統
-- MySQL 8.0.16+ / MariaDB 相容性請依版本測試
-- 本腳本是資料庫設計，不會被前端展示原型自動呼叫。
-- 組織鏈：董事長 -> 總經理 -> 生產副總 -> 生產經理 -> 課長 -> 股長 -> 組長；
-- 生管經理與生產經理協同。明確回覆未達成時，正式後端應依此鏈逐級建立上一級通知。

CREATE DATABASE IF NOT EXISTS lot_tracking
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
USE lot_tracking;

CREATE TABLE users (
  user_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_no VARCHAR(40) NULL,
  full_name VARCHAR(100) NOT NULL,
  department VARCHAR(100) NOT NULL,
  role_code ENUM('INSPECTOR','GROUP_LEADER','STOCK_LEADER','SECTION_CHIEF','PRODUCTION_MANAGER','PRODUCTION_CONTROL_MANAGER','PRODUCTION_VP','GENERAL_MANAGER','CHAIRMAN','ADMIN') NOT NULL,
  account VARCHAR(80) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_users_account (account),
  UNIQUE KEY uq_users_employee_no (employee_no),
  KEY idx_users_role_active (role_code, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE lots (
  lot_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lot_code VARCHAR(80) NOT NULL,
  product_code VARCHAR(80) NOT NULL,
  product_name VARCHAR(160) NULL,
  work_order VARCHAR(80) NULL,
  input_qty INT UNSIGNED NULL,
  print_good_threshold INT UNSIGNED NOT NULL,
  status ENUM('WAITING_INSPECTION','MIDDLE_QC_PENDING','READY_FOR_PRINT','CANCELLED') NOT NULL DEFAULT 'WAITING_INSPECTION',
  first_pending_at DATETIME NULL,
  first_ready_at DATETIME NULL,
  repeated_failure_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '首次未達後，再檢仍未達移轉門檻的次數',
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (lot_id),
  UNIQUE KEY uq_lots_lot_code (lot_code),
  KEY idx_lots_status_pending (status, first_pending_at),
  KEY idx_lots_product_code (product_code),
  CONSTRAINT chk_lots_threshold_positive CHECK (print_good_threshold > 0),
  CONSTRAINT fk_lots_created_by FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE inspections (
  inspection_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lot_id BIGINT UNSIGNED NOT NULL,
  inspector_id BIGINT UNSIGNED NOT NULL,
  inspected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  inspected_qty INT UNSIGNED NULL,
  newly_good_qty INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '本次新增、尚未計入過往紀錄的良品數',
  repair_or_rework_qty INT UNSIGNED NOT NULL DEFAULT 0,
  defect_qty INT UNSIGNED NOT NULL DEFAULT 0,
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (inspection_id),
  KEY idx_inspections_lot_time (lot_id, inspected_at),
  KEY idx_inspections_inspector_time (inspector_id, inspected_at),
  CONSTRAINT chk_inspections_new_good_nonnegative CHECK (newly_good_qty >= 0),
  CONSTRAINT fk_inspections_lot FOREIGN KEY (lot_id) REFERENCES lots(lot_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_inspections_inspector FOREIGN KEY (inspector_id) REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE dispositions (
  disposition_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lot_id BIGINT UNSIGNED NOT NULL,
  related_inspection_id BIGINT UNSIGNED NULL,
  round_no INT UNSIGNED NOT NULL,
  escalation_level ENUM('GROUP_LEADER','STOCK_LEADER','SECTION_CHIEF','PRODUCTION_MANAGER','PRODUCTION_CONTROL_MANAGER','PRODUCTION_VP','GENERAL_MANAGER','CHAIRMAN') NOT NULL DEFAULT 'PRODUCTION_MANAGER',
  action_text TEXT NOT NULL,
  owner_name VARCHAR(100) NOT NULL,
  progress_status ENUM('WAITING','IN_PROGRESS','WAITING_REINSPECTION','COMPLETED','CANCELLED') NOT NULL DEFAULT 'WAITING',
  expected_at DATE NULL,
  responder_id BIGINT UNSIGNED NOT NULL,
  replied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (disposition_id),
  KEY idx_dispositions_lot_round (lot_id, round_no),
  KEY idx_dispositions_owner_due (owner_name, expected_at),
  CONSTRAINT fk_dispositions_lot FOREIGN KEY (lot_id) REFERENCES lots(lot_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_dispositions_inspection FOREIGN KEY (related_inspection_id) REFERENCES inspections(inspection_id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_dispositions_responder FOREIGN KEY (responder_id) REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE notifications (
  notification_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lot_id BIGINT UNSIGNED NOT NULL,
  recipient_user_id BIGINT UNSIGNED NOT NULL,
  recipient_role_code ENUM('GROUP_LEADER','STOCK_LEADER','SECTION_CHIEF','PRODUCTION_MANAGER','PRODUCTION_CONTROL_MANAGER','PRODUCTION_VP','GENERAL_MANAGER','CHAIRMAN') NOT NULL,
  notification_level ENUM('FIRST_LINE','GENERAL_MANAGER','SUPERVISOR_ESCALATION','READY_NOTICE','OVERDUE') NOT NULL,
  event_key VARCHAR(160) NOT NULL COMMENT '同一事件可有多位收件人；以事件鍵及收件者避免重複通知',
  reason VARCHAR(255) NOT NULL,
  message TEXT NULL,
  channel ENUM('IN_APP','EMAIL') NOT NULL DEFAULT 'IN_APP',
  parent_notification_id BIGINT UNSIGNED NULL COMMENT '逐級升級時連回上一則通知',
  escalation_from_role ENUM('GROUP_LEADER','STOCK_LEADER','SECTION_CHIEF','PRODUCTION_MANAGER','PRODUCTION_CONTROL_MANAGER','PRODUCTION_VP','GENERAL_MANAGER','CHAIRMAN') NULL,
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME NULL,
  handled_at DATETIME NULL,
  PRIMARY KEY (notification_id),
  UNIQUE KEY uq_notification_event_recipient (event_key, recipient_user_id),
  KEY idx_notifications_recipient_status (recipient_user_id, read_at, sent_at),
  KEY idx_notifications_lot_level (lot_id, notification_level, sent_at),
  KEY idx_notifications_parent (parent_notification_id),
  CONSTRAINT fk_notifications_lot FOREIGN KEY (lot_id) REFERENCES lots(lot_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_notifications_parent FOREIGN KEY (parent_notification_id) REFERENCES notifications(notification_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE notification_responses (
  response_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  notification_id BIGINT UNSIGNED NOT NULL,
  responder_id BIGINT UNSIGNED NOT NULL,
  responder_role_code ENUM('GROUP_LEADER','STOCK_LEADER','SECTION_CHIEF','PRODUCTION_MANAGER','PRODUCTION_CONTROL_MANAGER','PRODUCTION_VP','GENERAL_MANAGER','CHAIRMAN') NOT NULL,
  progress_text TEXT NOT NULL COMMENT '主管回覆的目前進度與處置內容',
  expected_completion_date DATE NOT NULL COMMENT '主管承諾的預計完成日期',
  response_status ENUM('WAITING_FOLLOWUP','ACHIEVED','NOT_ACHIEVED') NOT NULL DEFAULT 'WAITING_FOLLOWUP',
  responded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  followed_up_by BIGINT UNSIGNED NULL,
  followed_up_at DATETIME NULL,
  followup_note TEXT NULL,
  escalated_notification_id BIGINT UNSIGNED NULL COMMENT '明確回覆未達成時所建立的上一級通知',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (response_id),
  KEY idx_responses_notification_time (notification_id, responded_at),
  KEY idx_responses_status_due (response_status, expected_completion_date),
  KEY idx_responses_escalation (escalated_notification_id),
  CONSTRAINT fk_responses_notification FOREIGN KEY (notification_id) REFERENCES notifications(notification_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_responses_responder FOREIGN KEY (responder_id) REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_responses_followup_user FOREIGN KEY (followed_up_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_responses_escalated_notification FOREIGN KEY (escalated_notification_id) REFERENCES notifications(notification_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE lot_status_history (
  history_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lot_id BIGINT UNSIGNED NOT NULL,
  old_status ENUM('WAITING_INSPECTION','MIDDLE_QC_PENDING','READY_FOR_PRINT','CANCELLED') NULL,
  new_status ENUM('WAITING_INSPECTION','MIDDLE_QC_PENDING','READY_FOR_PRINT','CANCELLED') NOT NULL,
  reason VARCHAR(255) NOT NULL,
  changed_by BIGINT UNSIGNED NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (history_id),
  KEY idx_status_history_lot_time (lot_id, changed_at),
  CONSTRAINT fk_history_lot FOREIGN KEY (lot_id) REFERENCES lots(lot_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_history_user FOREIGN KEY (changed_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE app_settings (
  setting_key VARCHAR(100) NOT NULL,
  setting_value VARCHAR(255) NOT NULL,
  description VARCHAR(255) NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_settings_user FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO app_settings (setting_key, setting_value, description) VALUES
  ('escalation_repeat_failures', '2', '重檢累計仍未達標幾次後依既有展示規則通知總經理；初始展示值，需工廠確認'),
  ('watch_days', '3', '注意等待天數；初始展示值，需工廠確認'),
  ('urgent_days', '5', '急迫等待天數；初始展示值，需工廠確認');

-- 對照檢視表：每個 LOT 的累計新增良品、差額與達成率。
CREATE OR REPLACE VIEW v_lot_progress AS
SELECT
  l.lot_id,
  l.lot_code,
  l.product_code,
  l.product_name,
  l.work_order,
  l.print_good_threshold,
  l.status,
  l.first_pending_at,
  l.first_ready_at,
  l.repeated_failure_count,
  COALESCE(SUM(i.newly_good_qty), 0) AS cumulative_good_qty,
  GREATEST(l.print_good_threshold - COALESCE(SUM(i.newly_good_qty), 0), 0) AS remaining_qty,
  ROUND(COALESCE(SUM(i.newly_good_qty), 0) * 100.0 / l.print_good_threshold, 1) AS attainment_percent
FROM lots AS l
LEFT JOIN inspections AS i ON i.lot_id = l.lot_id
GROUP BY l.lot_id, l.lot_code, l.product_code, l.product_name, l.work_order,
         l.print_good_threshold, l.status, l.first_pending_at, l.first_ready_at,
         l.repeated_failure_count;

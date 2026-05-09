-- ================================================
-- SETUP SCRIPT - Chạy trong Supabase SQL Editor
-- Dashboard > SQL Editor > New Query > Paste & Run
-- ================================================

-- 1. Bảng phòng
CREATE TABLE rooms (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    room_fee integer DEFAULT 700000,
    sort_order integer DEFAULT 0,
    created_at timestamptz DEFAULT now()
);

-- 2. Bảng cài đặt (1 row duy nhất)
CREATE TABLE settings (
    id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    elec_price integer DEFAULT 3000,
    water_price integer DEFAULT 11000,
    water_price_over integer DEFAULT 12000,
    garbage_fee integer DEFAULT 10000
);

-- 3. Bảng ghi điện nước (mỗi row = 1 phòng trong 1 kỳ)
CREATE TABLE records (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    start_date text NOT NULL,
    end_date text NOT NULL,
    room_id uuid REFERENCES rooms(id) ON DELETE CASCADE,
    elec_old integer DEFAULT 0,
    elec_new integer DEFAULT 0,
    water_old integer DEFAULT 0,
    water_new integer DEFAULT 0,
    created_at timestamptz DEFAULT now()
);

-- 4. Cho phép truy cập công khai (app cá nhân, không cần auth)
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_rooms" ON rooms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_settings" ON settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_records" ON records FOR ALL USING (true) WITH CHECK (true);

-- 5. Dữ liệu mặc định
INSERT INTO settings (id) VALUES (1);
INSERT INTO rooms (name, sort_order) VALUES
    ('Phòng 1', 1), ('Phòng 2', 2), ('Phòng 3', 3),
    ('Phòng 4', 4), ('Phòng 5', 5), ('Phòng 6', 6);

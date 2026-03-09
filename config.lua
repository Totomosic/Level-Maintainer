local cfg = {}

-- EXAMPLE --

-- [item_name] = {threshold, batch_size, fluid_name} -- fluid_name is REQUIRED for fluid drops
-- ["Osmium Dust"] = {nil, 64} -- regular item without threshold
-- ["drop of Molten SpaceTime"] = {1000000, 1, "spacetime"} -- fluid drop with threshold and fluid name

cfg["items"] = {
}

cfg["sleep"] = 10
cfg["config_url"] = nil -- optional URL to web backend /config endpoint, e.g. "http://localhost:3001/config"

return cfg

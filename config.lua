local cfg = {}

-- EXAMPLE --

-- [item_name] = {threshold, batch_size, fluid_name, priority}
-- priority: "standard" or "low"
-- fluid_name is REQUIRED for fluid drops
-- ["Osmium Dust"] = {nil, 64, nil, "standard"} -- regular item without threshold
-- ["drop of Molten SpaceTime"] = {1000000, 1, "spacetime", "low"} -- fluid drop with threshold and fluid name

cfg["items"] = {
    -- @group: Plasmas
    ["drop of Americium Plasma"] = {nil, 1, "plasma.americium", "standard"},
    ["drop of Copper Plasma"] = {nil, 1, "plasma.copper", "standard"}
}

cfg["sleep"] = 10
cfg["config_url"] = nil -- optional URL to web backend /config endpoint, e.g. "http://localhost:3001/config"
cfg["ignored_crafts"] = {
    -- case-insensitive substring matches against active craft names
    -- "Fake", -- matches "Fake asd1312"
}

return cfg

local cfg = {}

-- EXAMPLE --

-- [item_name] = {threshold, batch_size, fluid_name, priority}
-- priority: "standard" or "low"
-- fluid_name is REQUIRED for fluid drops
-- ["Osmium Dust"] = {nil, 64, nil, "standard"} -- regular item without threshold
-- ["drop of Molten SpaceTime"] = {1000000, 1, "spacetime", "low"} -- fluid drop with threshold and fluid name

cfg["items"] = {
    ["Agar"] = {nil, 1, nil, "standard"},
    ["Any UEV Circuit"] = {1000000000, 20000, nil, "low"},
    ["drop of Molten SpaceTime"] = {nil, 1, "spacetime", "standard"}
}

cfg["sleep"] = 10
cfg["config_url"] = nil -- optional URL to web backend /config endpoint, e.g. "http://localhost:3001/config"

return cfg

# Infinite Maintainer

Lets you passive lines easily, without lag and randomness of AE2 maintainer.
Also supports having a threshold.

# Setup

- Full block ME interface connected to an adapter
- Crafting Monitors on your CPUs
- (Internet card)
- OC stuff to make a basic computer

# Installation

Download it

```bash
wget raw.githubusercontent.com/totomosic/Level-Maintainer/master/installer.lua && installer
```

Run it

```bash
Maintainer
```

# Config

You can change maintained items in `config.lua`. Pattern is as follows: `["item_name"] = {threshold, batch_size}` as well as the time inbetween craft checks.

Optional remote config sync:

- `cfg["config_url"] = "http://<host>:3001/config"` to have `Maintainer.lua` poll and hot-reload config roughly every 60 seconds.
- Leave `cfg["config_url"] = nil` to use local-only config.

**!! Keep in mind that threshold should only be added if necessary and preferrably not in mainnet, since it has a performance impact !!**

Reboot after changing values.

# SAJ H2 Inverter Card Timer

A custom Home Assistant Lovelace card for controlling SAJ H2 inverter charge/discharge schedules with timer functionality.

## Features

- **Timer-based control**: Set specific start and end times for charge/discharge operations
- **Power display in kW**: Shows actual power values in kilowatts while maintaining percentage-based backend communication
- **Configurable max output**: Set maximum discharge power in the card configuration
- **Dual-function buttons**: Enable button extends current schedule or starts new one based on current state
- **Real-time status**: Shows current battery power and charge percentage
- **Clean UI**: Improved spacing and layout for better user experience

## Configuration

Add the card to your Lovelace dashboard with the following configuration:

```yaml
type: custom:saj-h2-inverter-card-timer
entity: sensor.saj_battery_charge_power_limit
max_discharge_kw: 5.0  # Configure your maximum discharge power in kW
```

## Required Entities

This card requires the following Home Assistant entities:
- `sensor.saj_battery_charge_power_limit`: Battery charge power limit sensor
- `sensor.saj_discharge_power_percent`: Discharge power percentage sensor
- `sensor.saj_battery_power`: Current battery power sensor
- `sensor.saj_battery_charge_percentage`: Battery charge percentage sensor

## Installation

1. Copy `saj-h2-inverter-card-timer.js` to your `www` folder in Home Assistant
2. Add the resource to your Lovelace dashboard configuration:

```yaml
resources:
  - url: /local/saj-h2-inverter-card-timer.js
    type: module
```

3. Add the card to your dashboard using the configuration above

## Development

This card converts between percentage values (used by the SAJ system) and kW values (displayed to the user) for better usability. The conversion is based on the configurable `max_discharge_kw` parameter.

### Key Functions

- `_percentToKw()`: Converts percentage to kW for display
- `_kwToPercent()`: Converts kW input to percentage for backend
- `_percentToSliderKw()`: Converts percentage to slider kW values
- `_sliderKwToPercent()`: Converts slider kW to percentage

### UI Features

- Dual-function Enable button that can start new schedules or extend existing ones
- Separate Disable button for clear operation control
- Compact duration input fields
- Improved button spacing and layout
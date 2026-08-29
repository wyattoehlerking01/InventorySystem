/**
 * LCHS Knowledge Base Module
 * Comprehensive guides, interactive calculators, hardware charts, and resources for engineering & robotics students.
 */

(function () {
    const KB_PINNED_STORAGE_KEY = 'lchs_kb_pinned_guides';
    const KB_CUSTOM_STORAGE_KEY = 'lchs_kb_custom_guides';

    // Built-in Curated Guides
    const DEFAULT_GUIDES = [
        {
            id: 'drivetrain-architectures',
            title: 'Robotics Drivetrain Architectures & Wheel Selection',
            category: 'robotics',
            categoryName: 'Robotics & Mechanisms',
            categoryIcon: 'ph-robot',
            readTime: '4 min read',
            tags: ['Drivetrains', 'Swerve', 'West Coast', 'Wheels', 'Traction'],
            summary: 'A complete comparison of Swerve (SDS/REV), West Coast Tank, and Mecanum drivetrains with wheel material selection guides.',
            content: `
                <h3>1. Drivetrain Architecture Comparison</h3>
                <p>Choosing the right drivetrain defines your robot's agility, pushing power, and mechanical complexity.</p>
                <div class="kb-table-wrap">
                    <table class="kb-table">
                        <thead>
                            <tr>
                                <th>Drive Type</th>
                                <th>Agility</th>
                                <th>Pushing Power</th>
                                <th>Complexity</th>
                                <th>Recommended For</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><strong>Swerve (SDS MK4i / REV MAX)</strong></td>
                                <td>⭐⭐⭐⭐⭐ (Holonomic)</td>
                                <td>⭐⭐⭐⭐ (High)</td>
                                <td>High (8 motors, PID azimuth)</td>
                                <td>Competitive FRC / Advanced FTC</td>
                            </tr>
                            <tr>
                                <td><strong>West Coast Drive (WCD / Tank)</strong></td>
                                <td>⭐⭐⭐ (Skid steer)</td>
                                <td>⭐⭐⭐⭐⭐ (Maximum)</td>
                                <td>Low - Medium</td>
                                <td>Defense robots, beginner builds, rough terrain</td>
                            </tr>
                            <tr>
                                <td><strong>Mecanum Drive</strong></td>
                                <td>⭐⭐⭐⭐ (Holonomic)</td>
                                <td>⭐ (Easily pushed)</td>
                                <td>Medium</td>
                                <td>Lightweight FTC / Classroom agility demos</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="kb-callout info">
                    <i class="ph-fill ph-info"></i>
                    <div>
                        <strong>Pro Tip - Drop Center:</strong> On 6-wheel or 8-wheel West Coast tank drives, always drop the center wheel(s) by <strong>1/8" (0.125")</strong> lower than the outer wheels. This reduces the effective wheelbase and eliminates turning scrub.
                    </div>
                </div>

                <h3>2. Wheel Material Selection</h3>
                <ul>
                    <li><strong>Colson Performa Wheels:</strong> Industry standard for high wear resistance, smooth turning on carpet, and consistent friction across match cycles.</li>
                    <li><strong>Nitrile / Roughtop Tread (Plasan):</strong> Maximum traction on FRC carpet. Higher wear rate; replace tread when worn to backing canvas.</li>
                    <li><strong>Omni-Directional Wheels:</strong> Roll freely sideways with perpendicular rollers. Great on rear/front corners of tank drive to reduce turning resistance.</li>
                    <li><strong>Compliant / TPU Wheels:</strong> Soft durometers (35A to 60A) ideal for spinning intakes, game piece compliance, and shooter indexers.</li>
                </ul>

                <h3>3. Sprint Speed & Free Speed Target</h3>
                <p>Target linear drive speed for high-traction brushless swerve modules:</p>
                <ul>
                    <li><strong>Sprint / Fast Swerve:</strong> 15.5 - 18.0 ft/sec (4.7 - 5.5 m/s) with Kraken X60 or Falcon 500.</li>
                    <li><strong>High-Torque / Controlled:</strong> 12.5 - 14.5 ft/sec (3.8 - 4.4 m/s) for rookie drivers or heavier robots.</li>
                </ul>
            `
        },
        {
            id: 'wiring-standards-can-bus',
            title: 'CAN Bus Architecture & Electrical Wiring Standards',
            category: 'electronics',
            categoryName: 'Electronics & Wiring',
            categoryIcon: 'ph-lightning',
            readTime: '5 min read',
            tags: ['CAN Bus', '12V DC', 'Wiring', 'Powerpole', 'Ferrules'],
            summary: 'Color coding standards, 120Ω termination rules, CANivore star vs daisy chain, and Anderson Powerpole crimp verification.',
            content: `
                <h3>1. Lab Color Code Standard</h3>
                <div class="kb-table-wrap">
                    <table class="kb-table">
                        <thead>
                            <tr>
                                <th>Signal / Circuit</th>
                                <th>Wire Color</th>
                                <th>Typical Gauge (AWG)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>+12V Main Battery / High Current</td>
                                <td><span class="kb-color-dot" style="background:#ef4444;"></span> Red</td>
                                <td>6 AWG / 4 AWG</td>
                            </tr>
                            <tr>
                                <td>Ground / Return (0V)</td>
                                <td><span class="kb-color-dot" style="background:#18181b;border:1px solid #71717a;"></span> Black</td>
                                <td>6 AWG / 4 AWG / 10-18 AWG</td>
                            </tr>
                            <tr>
                                <td>CAN High (CAN+)</td>
                                <td><span class="kb-color-dot" style="background:#eab308;"></span> Yellow</td>
                                <td>20-22 AWG (Twisted Pair)</td>
                            </tr>
                            <tr>
                                <td>CAN Low (CAN-)</td>
                                <td><span class="kb-color-dot" style="background:#22c55e;"></span> Green</td>
                                <td>20-22 AWG (Twisted Pair)</td>
                            </tr>
                            <tr>
                                <td>Sensor 5V / Signal</td>
                                <td><span class="kb-color-dot" style="background:#3b82f6;"></span> White / Blue</td>
                                <td>22-26 AWG</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <h3>2. The Golden Rules of CAN Bus</h3>
                <div class="kb-callout warning">
                    <i class="ph-fill ph-warning-octagon"></i>
                    <div>
                        <strong>120Ω Terminating Resistor Requirement:</strong> Every CAN bus transmission line MUST have exactly two 120Ω terminating resistors—one at each physical end of the bus (typically inside the roboRIO and inside the PDP/PDH). When measuring resistance between CAN Yellow and Green with power OFF, a healthy bus measures <strong>60Ω ± 3Ω</strong>.
                    </div>
                </div>
                <ul>
                    <li><strong>Twist Yellow & Green:</strong> Twist CAN wires ~1 turn per inch (2-3 cm) to reject electromagnetic noise from motor switching.</li>
                    <li><strong>Anderson Powerpole Crimping:</strong> Use the TRIcrimp or 1377G1 ratcheting tool. Ensure the contact's open seam faces upward into the die.</li>
                    <li><strong>The Pull Test:</strong> Firmly pull every crimped terminal with 15+ lbs of hand force. If the wire slips or strands pull out, cut and re-crimp immediately.</li>
                    <li><strong>Ferrules for Spring Terminals:</strong> Always crimp insulated bootlace ferrules onto stranded wire before inserting into Weidmuller or WAGO spring connectors (REV PDH, Pneumatics Hub, roboRIO power). Stray strands cause intermittent shorts!</li>
                </ul>
            `
        },
        {
            id: 'fasteners-tap-drill-guide',
            title: 'Fasteners Standard Chart & Tap Drill Lookup',
            category: 'machining',
            categoryName: 'Shop Tools & Machining',
            categoryIcon: 'ph-wrench',
            readTime: '3 min read',
            tags: ['Fasteners', '10-32', 'Tap Drill', 'Screws', 'Clearance'],
            summary: 'Standard drill sizes for clearance and tapping #4-40, #8-32, #10-32, 1/4"-20, and Metric M3-M6 hardware with Allen wrench sizes.',
            content: `
                <h3>1. Common Robotics Fasteners & Drill Chart</h3>
                <p>Always drill the correct tap hole size before threading aluminum or steel. Tapping a hole drilled too small will snap the tap inside the workpiece!</p>
                <div class="kb-table-wrap">
                    <table class="kb-table">
                        <thead>
                            <tr>
                                <th>Screw Size</th>
                                <th>Major Dia.</th>
                                <th>Clearance Drill (Close)</th>
                                <th>Aluminum Tap Drill (75%)</th>
                                <th>Allen Key / Driver</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><strong>#4-40 UNC</strong></td>
                                <td>0.112" (2.84mm)</td>
                                <td>#32 (0.116")</td>
                                <td>#43 (0.089")</td>
                                <td>3/32" Hex</td>
                            </tr>
                            <tr>
                                <td><strong>#8-32 UNC</strong></td>
                                <td>0.164" (4.17mm)</td>
                                <td>#18 (0.170")</td>
                                <td>#29 (0.136")</td>
                                <td>9/64" Hex</td>
                            </tr>
                            <tr>
                                <td><strong>#10-32 UNF (Robotics Standard!)</strong></td>
                                <td>0.190" (4.83mm)</td>
                                <td>#7 (0.201") or 13/64"</td>
                                <td>#21 (0.159") or 5/32"</td>
                                <td>5/32" Hex (SHCS) / 1/8" (BHCS)</td>
                            </tr>
                            <tr>
                                <td><strong>#10-24 UNC (Coarse)</strong></td>
                                <td>0.190" (4.83mm)</td>
                                <td>#7 (0.201")</td>
                                <td>#25 (0.149")</td>
                                <td>5/32" Hex</td>
                            </tr>
                            <tr>
                                <td><strong>1/4"-20 UNC</strong></td>
                                <td>0.250" (6.35mm)</td>
                                <td>Letter F (0.257") or 17/64"</td>
                                <td>#7 (0.201")</td>
                                <td>3/16" Hex</td>
                            </tr>
                            <tr>
                                <td><strong>M3 x 0.5</strong></td>
                                <td>3.00mm (0.118")</td>
                                <td>3.1mm / 1/8"</td>
                                <td>2.5mm (#39)</td>
                                <td>2.5mm Hex</td>
                            </tr>
                            <tr>
                                <td><strong>M4 x 0.7</strong></td>
                                <td>4.00mm (0.157")</td>
                                <td>4.2mm (#19)</td>
                                <td>3.3mm (#30)</td>
                                <td>3.0mm Hex</td>
                            </tr>
                            <tr>
                                <td><strong>M5 x 0.8</strong></td>
                                <td>5.00mm (0.197")</td>
                                <td>5.2mm (#8)</td>
                                <td>4.2mm (#19)</td>
                                <td>4.0mm Hex</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="kb-callout warning">
                    <i class="ph-fill ph-warning"></i>
                    <div>
                        <strong>Beware #10-32 vs #10-24:</strong> Both have a 0.190" diameter, but #10-32 has 32 threads/inch (fine) while #10-24 has 24 threads/inch (coarse). Forcing a #10-32 screw into a #10-24 tapped hole will ruin both the screw and the component. Keep them sorted!
                    </div>
                </div>

                <h3>2. Hardware Types & Best Practices</h3>
                <ul>
                    <li><strong>Socket Head Cap Screws (SHCS):</strong> Maximum clamping force and deep hex sockets that resist stripping. Preferred for structural frame assembly.</li>
                    <li><strong>Button Head Cap Screws (BHCS):</strong> Low-profile head; great where clearance with moving belts/chains is tight. Use caution not to round out the shallower hex.</li>
                    <li><strong>Nylon Insert Locknuts (Nyloc):</strong> Vibration-resistant nuts. Never reuse a Nyloc nut that can be threaded completely by fingers alone.</li>
                    <li><strong>Loctite 242 (Blue):</strong> Medium strength threadlocker for metal-to-metal threads. Never use Red Loctite on aluminum unless you intend it to be permanent with heat removal.</li>
                </ul>
            `
        },
        {
            id: '3d-printing-structural-parts',
            title: '3D Printing Structural Robotics Parts & Filament Guide',
            category: '3dprint',
            categoryName: '3D Printing & CAD',
            categoryIcon: 'ph-cube',
            readTime: '4 min read',
            tags: ['3D Printing', 'Filament', 'PLA', 'PETG', 'TPU', 'Nylon'],
            summary: 'Slicer configuration for high-load robot parts, perimeter counts vs infill, and material selection (PLA vs PETG vs TPU vs PACF).',
            content: `
                <h3>1. Slicer Secrets for Heavy-Duty Parts</h3>
                <div class="kb-callout info">
                    <i class="ph-fill ph-lightbulb"></i>
                    <div>
                        <strong>Perimeters > Infill:</strong> Increasing your wall loop/perimeter count from 2 to 5 adds up to <strong>300% more torsional and bending strength</strong> than increasing infill from 20% to 80%!
                    </div>
                </div>

                <ul>
                    <li><strong>Wall Loops / Perimeters:</strong> 4 to 6 walls minimum for structural brackets, motor mounts, and gearbox plates.</li>
                    <li><strong>Infill Pattern:</strong> Use <strong>Gyroid</strong> or <strong>Cubic</strong> infill at 30% - 45%. Avoid Grid or Triangle infill because nozzle crossings can knock prints off the bed and cause layer shear.</li>
                    <li><strong>Layer Orientation:</strong> 3D prints are weakest along the Z-axis (between layer lines). Orient parts so tensile loads run parallel to the build plate (X/Y plane), not pulling layers apart.</li>
                    <li><strong>Heat-Set Threaded Inserts:</strong> Instead of screwing directly into plastic, design tapered holes and press in brass M3 or #10-32 heat-set inserts using a soldering iron set to 220°C - 240°C.</li>
                </ul>

                <h3>2. Material Comparison Matrix</h3>
                <div class="kb-table-wrap">
                    <table class="kb-table">
                        <thead>
                            <tr>
                                <th>Material</th>
                                <th>Rigidity</th>
                                <th>Impact Strength</th>
                                <th>Heat Deflection</th>
                                <th>Best Used For</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><strong>PLA+ / Tough PLA</strong></td>
                                <td>⭐⭐⭐⭐⭐ Very High</td>
                                <td>⭐⭐ Moderate</td>
                                <td>55°C (Low)</td>
                                <td>Fast prototyping, sensor brackets, non-heated structural mounts</td>
                            </tr>
                            <tr>
                                <td><strong>PETG</strong></td>
                                <td>⭐⭐⭐ Moderate</td>
                                <td>⭐⭐⭐⭐ High</td>
                                <td>75°C (Good)</td>
                                <td>Battery mounts, intake gussets, outdoor parts</td>
                            </tr>
                            <tr>
                                <td><strong>TPU 95A / Flex</strong></td>
                                <td>⭐ Flexible</td>
                                <td>⭐⭐⭐⭐⭐ Indestructible</td>
                                <td>90°C (High)</td>
                                <td>Intake rollers, compliant wheels, soft bumpers, wire grommets</td>
                            </tr>
                            <tr>
                                <td><strong>PA-CF (Nylon Carbon Fiber)</strong></td>
                                <td>⭐⭐⭐⭐⭐ Extreme</td>
                                <td>⭐⭐⭐⭐⭐ Extreme</td>
                                <td>150°C+ (Superior)</td>
                                <td>Drive pulleys, high-stress swerve brackets, custom gearboxes</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            `
        },
        {
            id: 'shop-power-tool-safety',
            title: 'Machine Shop & Power Tool Safety Protocols',
            category: 'safety',
            categoryName: 'Safety & Protocols',
            categoryIcon: 'ph-shield-check',
            readTime: '3 min read',
            tags: ['Safety', 'PPE', 'Drill Press', 'Bandsaw', 'Eye Protection'],
            summary: 'Mandatory PPE rules, safe feeds and speeds, clamping protocols for drill presses and bandsaws, and emergency stop steps.',
            content: `
                <h3>1. The 5 Mandatory Shop Safety Rules</h3>
                <div class="kb-callout warning">
                    <i class="ph-fill ph-warning-octagon"></i>
                    <div>
                        <strong>Zero Tolerance Safety Standard:</strong> Anyone operating or standing near machine tools without approved eye protection will be asked to step away from the work area immediately.
                    </div>
                </div>

                <ol>
                    <li><strong>Eye Protection:</strong> ANSI Z87.1 approved safety glasses must be on your face whenever tools, soldering irons, or robots are active in the room.</li>
                    <li><strong>No Rotating Machinery Hazards:</strong> Absolutely NO gloves, long ties, loose lanyards, long loose hair, or rings near spinning machinery (Drill Press, Lathe, Mill, Grinder). Hair must be tied back securely.</li>
                    <li><strong>Always Clamp Your Workpiece:</strong> NEVER hold a piece of sheet metal or bar stock by hand on the drill press table. If the drill bit catches, the metal will spin like a propeller and cause severe injury. Use drill press clamps or a vise.</li>
                    <li><strong>Bandsaw Blade Guard:</strong> Adjust the top blade guide to sit no more than <strong>1/4" (6mm)</strong> above the top surface of your workpiece before cutting.</li>
                    <li><strong>Know Your E-Stop:</strong> Locate the main emergency power disconnect switch and wall-mounted fire extinguisher before operating heavy equipment.</li>
                </ol>

                <h3>2. Speeds & Feeds Quick Guide</h3>
                <ul>
                    <li><strong>Small Drill Bits (under 1/8"):</strong> High spindle RPM (~2,000 - 3,000 RPM) with light, steady feed pressure.</li>
                    <li><strong>Large Drill Bits & Hole Saws (over 1/2"):</strong> Low spindle RPM (~400 - 800 RPM). Use cutting fluid (Tap Magic or WD-40) on aluminum to prevent chip welding.</li>
                    <li><strong>Polycarbonate (Lexan) vs Acrylic:</strong> Cut Polycarbonate on bandsaws with fine-tooth blades. NEVER use brittle Acrylic (Plexiglas) for robot structural components, as it shatters into razor-sharp shards upon impact.</li>
                </ul>
            `
        },
        {
            id: 'lipo-and-sla-battery-safety',
            title: 'LiPo & 12V SLA Battery Maintenance and Charging Safety',
            category: 'safety',
            categoryName: 'Safety & Protocols',
            categoryIcon: 'ph-battery-charging',
            readTime: '4 min read',
            tags: ['Battery', 'LiPo', 'SLA', 'Charging', 'Safety'],
            summary: '1C charge rate limits, storage voltage preservation, identifying swollen LiPo packs, and battery spill response.',
            content: `
                <h3>1. Lithium Polymer (LiPo) Charging Golden Rules</h3>
                <ul>
                    <li><strong>1C Charge Rate Limit:</strong> Always set charger current to 1C or lower (Current in Amps = Battery Capacity in mAh / 1000). For a 2200mAh battery, charge at max <strong>2.2 Amps</strong>.</li>
                    <li><strong>Always Balance Charge:</strong> Plug in both the main XT60/Anderson power lead AND the white JST balance plug so the charger keeps individual cell voltages equal.</li>
                    <li><strong>Fireproof Charging Enclosure:</strong> Charge all LiPo packs inside a certified fireproof LiPo sack or heavy ammo can on a non-flammable surface.</li>
                    <li><strong>Storage Voltage:</strong> Never store LiPo batteries fully charged (4.20V/cell) or depleted (<3.50V/cell). Run the charger's "Storage Mode" to bring cells to <strong>3.80V - 3.85V per cell</strong>.</li>
                </ul>

                <div class="kb-callout warning">
                    <i class="ph-fill ph-warning"></i>
                    <div>
                        <strong>Puffed / Damaged LiPo Hazard:</strong> If a battery feels puffy, swollen, has a sweet chemical smell, or drops below 3.0V on any cell, DO NOT CHARGE IT. Inform a mentor immediately and place it in the battery quarantine bucket.
                    </div>
                </div>

                <h3>2. FRC 12V 18Ah Sealed Lead Acid (SLA) Batteries</h3>
                <ul>
                    <li><strong>Float Voltage:</strong> Fully charged SLA resting voltage is <strong>12.8V - 13.2V</strong>. Float charge maintains 13.5V - 13.8V.</li>
                    <li><strong>Battery Beak Analyzer:</strong> Use the Battery Beak to check Internal Resistance (IR). Good competition batteries measure <strong>< 0.015Ω (<15 mΩ)</strong>. Batteries with IR > 0.022Ω should be relegated to practice and bench testing.</li>
                    <li><strong>Spill Response:</strong> Keep a box of Baking Soda (Sodium Bicarbonate) on the battery cart to neutralize acidic electrolyte in case of dropped/cracked casings.</li>
                </ul>
            `
        },
        {
            id: 'pid-tuning-closed-loop',
            title: 'PID Controller Tuning & Feedforward Cheatsheet',
            category: 'programming',
            categoryName: 'Code & Control Systems',
            categoryIcon: 'ph-code',
            readTime: '5 min read',
            tags: ['PID', 'Control', 'Encoders', 'Tuning', 'WPILib'],
            summary: 'Step-by-step procedure to tune kP, kI, kD, and feedforward (kS, kV, kA) constants for robot arms, flywheels, and swerve drive.',
            content: `
                <h3>1. Understanding the PID Terms</h3>
                <div class="kb-table-wrap">
                    <table class="kb-table">
                        <thead>
                            <tr>
                                <th>Term</th>
                                <th>Role</th>
                                <th>Too Low</th>
                                <th>Too High</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><strong>kP (Proportional)</strong></td>
                                <td>Corrects current position or velocity error proportionally.</td>
                                <td>Sluggish response; never reaches setpoint under load.</td>
                                <td>Violent oscillations and jittering around target.</td>
                            </tr>
                            <tr>
                                <td><strong>kD (Derivative)</strong></td>
                                <td>Dampens rate of change and acts like a shock absorber.</td>
                                <td>Overshoots setpoint during fast movements.</td>
                                <td>High-frequency vibrations and motor buzzing.</td>
                            </tr>
                            <tr>
                                <td><strong>kI (Integral)</strong></td>
                                <td>Eliminates tiny persistent steady-state error over time.</td>
                                <td>Small offset error remains at rest.</td>
                                <td>Windup destabilization and severe overshoot. (Use sparingly!)</td>
                            </tr>
                            <tr>
                                <td><strong>kS / kV (Feedforward)</strong></td>
                                <td>Calculates baseline voltage for static friction (kS) and velocity (kV).</td>
                                <td>Feedback has to do all the heavy lifting.</td>
                                <td>Overshoots speed before feedback loop engages.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <h3>2. The 5-Step Tuning Procedure</h3>
                <ol>
                    <li><strong>Zero Out Everything:</strong> Set kP = 0, kI = 0, kD = 0, and all feedforward terms to 0.</li>
                    <li><strong>Tune Feedforward (kV & kS):</strong> Measure the voltage required to just barely move the mechanism (kS). Then calculate kV = 12.0V / Maximum Mechanism Velocity.</li>
                    <li><strong>Increase kP:</strong> Gradually increase kP until the mechanism moves promptly to the target setpoint with a small amount of overshoot.</li>
                    <li><strong>Increase kD:</strong> Add kD in small increments to dampen out the overshoot until the mechanism settles cleanly without bounce.</li>
                    <li><strong>Add kI only if needed:</strong> If steady-state error persists, add a tiny kI value with an integral zone (iZone) limit to prevent windup.</li>
                </ol>
            `
        },
        {
            id: 'soldering-and-wire-splicing',
            title: 'Precision Soldering & High-Reliability Wire Splicing',
            category: 'electronics',
            categoryName: 'Electronics & Wiring',
            categoryIcon: 'ph-lightning',
            readTime: '3 min read',
            tags: ['Soldering', 'Splicing', 'Heatshrink', 'Flux', 'Linemans'],
            summary: 'Iron temperature settings, tinning techniques, Lineman’s/Western Union mechanical splice, and adhesive-lined heat shrink.',
            content: `
                <h3>1. Soldering Temperature & Setup</h3>
                <ul>
                    <li><strong>Temperature Setting:</strong> 350°C - 380°C (660°F - 715°F) for 60/40 or 63/37 leaded solder. 380°C - 400°C for lead-free solder.</li>
                    <li><strong>Tip Maintenance:</strong> Clean the iron tip on a damp brass wire sponge, then immediately apply a fresh dab of solder ("tinning") before and after every joint to prevent oxidation.</li>
                    <li><strong>Heat the Joint, Not the Solder:</strong> Place the iron tip touching BOTH wires or pads for 2-3 seconds, then touch solder wire to the heated metal joint. Solder should flow freely like water.</li>
                </ul>

                <h3>2. Western Union / Lineman’s Splice</h3>
                <p>When joining two wires in a robot where vibrations and flexing occur, never twist wires side-by-side. Use the Western Union splice:</p>
                <ol>
                    <li>Strip 3/4" (20mm) of insulation from both wire ends.</li>
                    <li>Slide dual-wall adhesive heat shrink tubing onto one wire BEFORE splicing.</li>
                    <li>Cross the bare strands into an "X", then wrap each wire tightly around the other core in opposite directions (minimum 4 tight coils).</li>
                    <li>Flow solder through the braided joint until all strands are coated.</li>
                    <li>Slide the heat shrink over the joint and shrink with a heat gun until sealant beads at the edges.</li>
                </ol>
            `
        },
        {
            id: 'pneumatics-plumbing-regulations',
            title: 'Pneumatics Plumbing & Pressure Regulations',
            category: 'robotics',
            categoryName: 'Robotics & Mechanisms',
            categoryIcon: 'ph-gauge',
            readTime: '4 min read',
            tags: ['Pneumatics', 'Solenoids', 'Regulators', 'Air', 'Cylinders'],
            summary: 'Working vs stored pressure limits, push-to-connect fitting reliability, relief valve calibration, and leak detection.',
            content: `
                <h3>1. Pressure Boundaries & Regulators</h3>
                <div class="kb-callout info">
                    <i class="ph-fill ph-info"></i>
                    <div>
                        <strong>Standard FRC Pneumatics Limits:</strong> Maximum stored tank pressure = <strong>120 PSI (8.27 bar)</strong>. Maximum working actuator pressure downstream of the primary regulator = <strong>60 PSI (4.13 bar)</strong>.
                    </div>
                </div>

                <ul>
                    <li><strong>Pressure Relief Valve:</strong> Must be installed directly on the compressor output manifold and calibrated to vent air at 125 PSI.</li>
                    <li><strong>Double-Acting Cylinders:</strong> Requires two air lines connected to a 5-way 2-position solenoid valve. Push-to-connect (PTC) fittings must be cleanly seated.</li>
                    <li><strong>Cutting Pneumatic Tubing:</strong> ALWAYS use a designated razor tubing cutter. Never use wire cutters or scissors, as pinching the tube creates an oval profile that leaks inside PTC fittings.</li>
                    <li><strong>Finding Leaks:</strong> Spray fittings with soapy water (or Windex). If growing foam bubbles appear, re-cut the tubing or re-tape the NPT threads with Teflon tape (leaving the first 2 threads bare).</li>
                </ul>
            `
        },
        {
            id: 'cad-parametric-modeling-standards',
            title: 'CAD Modeling Standards & Onshape / Fusion 360 Workflows',
            category: '3dprint',
            categoryName: '3D Printing & CAD',
            categoryIcon: 'ph-cube',
            readTime: '4 min read',
            tags: ['CAD', 'Onshape', 'Fusion 360', 'Parametric', 'Clearance'],
            summary: 'Master sketch architecture, parametric variables, bearing hole tolerances, and STEP export standards for CNC/Laser.',
            content: `
                <h3>1. Top-Down Master Sketch Workflow</h3>
                <p>Build robust CAD assemblies that update dynamically when robot dimensions change:</p>
                <ul>
                    <li><strong>The Layout / Skeleton Sketch:</strong> Create a single master 2D sketch at the top of your Part Studio with major dimensions (frame perimeter, wheel centers, ground clearance, game piece envelope).</li>
                    <li><strong>Derive Downstream Parts:</strong> Reference geometry directly from the master sketch so changing a single variable updates plates, belts, and spacers automatically.</li>
                    <li><strong>Fully Constrain All Sketches:</strong> Every sketch entity should be black (fully defined with dimensions or geometric constraints like coincident, tangent, parallel). Blue lines mean undefined geometry prone to breaking.</li>
                </ul>

                <h3>2. Manufacturing Hole Tolerances</h3>
                <div class="kb-table-wrap">
                    <table class="kb-table">
                        <thead>
                            <tr>
                                <th>Feature</th>
                                <th>Nominal Size</th>
                                <th>CNC / Laser CAD Dimension</th>
                                <th>3D Print CAD Dimension</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>FRC 1/2" Hex Flanged Bearing</td>
                                <td>1.125" (28.575mm)</td>
                                <td>1.124" (Press Fit) / 1.126" (Slip)</td>
                                <td>1.135" (Compensate shrinkage)</td>
                            </tr>
                            <tr>
                                <td>#10-32 Clearance Hole</td>
                                <td>0.190" (4.83mm)</td>
                                <td>0.201" (#7 Drill)</td>
                                <td>0.210"</td>
                            </tr>
                            <tr>
                                <td>1/4"-20 Clearance Hole</td>
                                <td>0.250" (6.35mm)</td>
                                <td>0.257" (Letter F)</td>
                                <td>0.270"</td>
                            </tr>
                            <tr>
                                <td>3/16" Aluminum Pop Rivet</td>
                                <td>0.1875" (4.76mm)</td>
                                <td>0.193" (#10 Drill)</td>
                                <td>0.200"</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            `
        },
        {
            id: 'hand-tools-precision-measurement',
            title: 'Precision Measurement & Hand Tool Proficiency',
            category: 'machining',
            categoryName: 'Shop Tools & Machining',
            categoryIcon: 'ph-ruler',
            readTime: '3 min read',
            tags: ['Calipers', 'Measurement', 'Deburring', 'Rivets', 'Tools'],
            summary: 'Using digital dial calipers correctly, deburring razor metal edges, pop rivet installation, and torque guidelines.',
            content: `
                <h3>1. Digital Caliper 4-Way Measurement</h3>
                <p>Digital calipers can measure 4 distinct dimensions with 0.001" (0.025mm) precision:</p>
                <ul>
                    <li><strong>Outside Jaws:</strong> Measure shaft diameters, plate thickness, and outer box widths.</li>
                    <li><strong>Inside Jaws:</strong> Measure hole diameters, slot widths, and tube internal dimensions.</li>
                    <li><strong>Depth Gauge Rod:</strong> Extends from the bottom to measure pocket depths and blind holes.</li>
                    <li><strong>Step Gauge (Back):</strong> Measures height differences between stepped surfaces.</li>
                </ul>

                <div class="kb-callout info">
                    <i class="ph-fill ph-info"></i>
                    <div>
                        <strong>Always Zero Before Measuring:</strong> Wipe the caliper jaws clean with your finger, close them completely with gentle thumb pressure, and verify the display reads <strong>0.000"</strong> before taking any measurement.
                    </div>
                </div>

                <h3>2. Edge Deburring & Finishing</h3>
                <ul>
                    <li><strong>Noga Deburring Tool:</strong> Swivel the curved blade along freshly sheared or bandsawed aluminum edges to remove razor-sharp burrs in a single pass.</li>
                    <li><strong>Countersink Bit for Holes:</strong> Spin a 90° single-flute countersink bit by hand or with a drill on low speed to deburr drilled holes before riveting.</li>
                </ul>
            `
        },
        {
            id: 'engineering-links-catalogs',
            title: 'Official Robotics Rulebooks, Vendor Catalogs & Portals',
            category: 'links',
            categoryName: 'External Links & Portals',
            categoryIcon: 'ph-link',
            readTime: '1 min quick ref',
            tags: ['Links', 'WPILib', 'ChiefDelphi', 'McMaster', 'WCP', 'REV'],
            summary: 'Fast links to official documentation, CAD libraries, McMaster hardware lookup, and community discussion boards.',
            content: `
                <h3>Essential Robotics & Engineering Portals</h3>
                <div class="kb-links-grid">
                    <a href="https://docs.wpilib.org" target="_blank" rel="noopener noreferrer" class="kb-link-card">
                        <div class="kb-link-icon"><i class="ph ph-file-code"></i></div>
                        <div>
                            <h4>WPILib Official Documentation</h4>
                            <p>Programming guides for Command-Based Java/C++, Swerve drive, and sensors.</p>
                        </div>
                        <i class="ph ph-arrow-square-out kb-link-arrow"></i>
                    </a>
                    <a href="https://www.chiefdelphi.com" target="_blank" rel="noopener noreferrer" class="kb-link-card">
                        <div class="kb-link-icon"><i class="ph ph-chat-centered-text"></i></div>
                        <div>
                            <h4>Chief Delphi Forum</h4>
                            <p>Global robotics engineering community for design reveals and troubleshooting.</p>
                        </div>
                        <i class="ph ph-arrow-square-out kb-link-arrow"></i>
                    </a>
                    <a href="https://wcproducts.com" target="_blank" rel="noopener noreferrer" class="kb-link-card">
                        <div class="kb-link-icon"><i class="ph ph-gear"></i></div>
                        <div>
                            <h4>WestCoast Products (WCP)</h4>
                            <p>Kraken X60 motors, gearboxes, swerve modules, and CAD libraries.</p>
                        </div>
                        <i class="ph ph-arrow-square-out kb-link-arrow"></i>
                    </a>
                    <a href="https://www.revrobotics.com" target="_blank" rel="noopener noreferrer" class="kb-link-card">
                        <div class="kb-link-icon"><i class="ph ph-circuit-board"></i></div>
                        <div>
                            <h4>REV Robotics Portal</h4>
                            <p>SPARK MAX, NEO Brushless, PDH power distribution, and MAXSwerve specs.</p>
                        </div>
                        <i class="ph ph-arrow-square-out kb-link-arrow"></i>
                    </a>
                    <a href="https://www.mcmaster.com" target="_blank" rel="noopener noreferrer" class="kb-link-card">
                        <div class="kb-link-icon"><i class="ph ph-nut"></i></div>
                        <div>
                            <h4>McMaster-Carr Hardware Catalog</h4>
                            <p>Instant 3D STEP models, raw stock metal specs, fasteners, and bearings.</p>
                        </div>
                        <i class="ph ph-arrow-square-out kb-link-arrow"></i>
                    </a>
                    <a href="https://learn.onshape.com" target="_blank" rel="noopener noreferrer" class="kb-link-card">
                        <div class="kb-link-icon"><i class="ph ph-cube"></i></div>
                        <div>
                            <h4>Onshape Learning Center</h4>
                            <p>Self-paced courses for cloud CAD, FeatureScript, and multi-user assemblies.</p>
                        </div>
                        <i class="ph ph-arrow-square-out kb-link-arrow"></i>
                    </a>
                </div>
            `
        }
    ];

    // State
    let activeCategory = 'all';
    let searchQuery = '';
    let isCalculatorsView = false;
    let isPinnedOnlyView = false;

    // Helper: Get Pinned IDs from LocalStorage
    function getPinnedGuideIds() {
        try {
            const raw = localStorage.getItem(KB_PINNED_STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    function togglePinGuide(guideId) {
        let pinned = getPinnedGuideIds();
        if (pinned.includes(guideId)) {
            pinned = pinned.filter(id => id !== guideId);
        } else {
            pinned.push(guideId);
        }
        localStorage.setItem(KB_PINNED_STORAGE_KEY, JSON.stringify(pinned));
        updatePinnedBadgeCount();
        renderKnowledgeBaseContent();
    }

    function getCustomGuides() {
        try {
            const raw = localStorage.getItem(KB_CUSTOM_STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    function saveCustomGuide(guide) {
        const list = getCustomGuides();
        const existingIdx = list.findIndex(g => g.id === guide.id);
        if (existingIdx >= 0) {
            list[existingIdx] = guide;
        } else {
            list.unshift(guide);
        }
        localStorage.setItem(KB_CUSTOM_STORAGE_KEY, JSON.stringify(list));
        renderKnowledgeBaseContent();
    }

    function getAllGuides() {
        const custom = getCustomGuides();
        return [...custom, ...DEFAULT_GUIDES];
    }

    function updatePinnedBadgeCount() {
        const countEl = document.getElementById('kb-pinned-count');
        if (countEl) {
            const pinned = getPinnedGuideIds();
            countEl.textContent = String(pinned.length);
        }
    }

    // Categories
    const CATEGORIES = [
        { id: 'all', label: 'All Resources', icon: 'ph-squares-four' },
        { id: 'robotics', label: 'Robotics & Mechanisms', icon: 'ph-robot' },
        { id: 'electronics', label: 'Electronics & Wiring', icon: 'ph-lightning' },
        { id: '3dprint', label: '3D Printing & CAD', icon: 'ph-cube' },
        { id: 'machining', label: 'Shop Tools & Fasteners', icon: 'ph-wrench' },
        { id: 'programming', label: 'Programming & PID', icon: 'ph-code' },
        { id: 'safety', label: 'Safety & Protocols', icon: 'ph-shield-check' },
        { id: 'calculators', label: 'Interactive Calculators', icon: 'ph-calculator' },
        { id: 'links', label: 'External Portals', icon: 'ph-link' }
    ];

    function renderKnowledgeBaseSkeleton() {
        const container = document.getElementById('kb-content-container');
        if (!container) return;
        container.innerHTML = `
            <div class="kb-grid">
                ${Array.from({ length: 6 }).map(() => `
                    <div class="kb-card skeleton-card glass-panel flex-col">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
                            <div class="skeleton-pill skeleton-shimmer" style="width:110px;height:22px;"></div>
                            <div class="skeleton-pill skeleton-shimmer" style="width:70px;height:20px;"></div>
                        </div>
                        <div class="skeleton-line skeleton-shimmer" style="width:85%;height:22px;margin-bottom:0.6rem;"></div>
                        <div class="skeleton-line skeleton-shimmer" style="width:100%;height:14px;margin-bottom:0.35rem;"></div>
                        <div class="skeleton-line skeleton-shimmer" style="width:75%;height:14px;margin-bottom:1rem;"></div>
                        <div style="display:flex;gap:0.4rem;margin-bottom:1.2rem;">
                            <div class="skeleton-pill skeleton-shimmer" style="width:60px;height:18px;"></div>
                            <div class="skeleton-pill skeleton-shimmer" style="width:50px;height:18px;"></div>
                            <div class="skeleton-pill skeleton-shimmer" style="width:70px;height:18px;"></div>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto;">
                            <div class="skeleton-line skeleton-shimmer" style="width:90px;height:14px;"></div>
                            <div class="skeleton-btn skeleton-shimmer" style="width:80px;height:32px;"></div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderCategoryPills() {
        const pillsContainer = document.getElementById('kb-category-pills');
        if (!pillsContainer) return;

        pillsContainer.innerHTML = CATEGORIES.map(cat => {
            const isActive = (!isCalculatorsView && !isPinnedOnlyView && activeCategory === cat.id) ||
                (isCalculatorsView && cat.id === 'calculators');
            return `
                <button class="kb-pill ${isActive ? 'active' : ''}" data-cat="${cat.id}">
                    <i class="ph ${cat.icon}"></i> ${cat.label}
                </button>
            `;
        }).join('');

        pillsContainer.querySelectorAll('.kb-pill').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const cat = e.currentTarget.getAttribute('data-cat');
                if (cat === 'calculators') {
                    isCalculatorsView = true;
                    isPinnedOnlyView = false;
                } else {
                    isCalculatorsView = false;
                    isPinnedOnlyView = false;
                    activeCategory = cat;
                }
                updatePillStates();
                renderKnowledgeBaseContent();
            });
        });
    }

    function updatePillStates() {
        document.querySelectorAll('#kb-category-pills .kb-pill').forEach(btn => {
            const cat = btn.getAttribute('data-cat');
            const isActive = (!isCalculatorsView && !isPinnedOnlyView && activeCategory === cat) ||
                (isCalculatorsView && cat === 'calculators');
            btn.classList.toggle('active', isActive);
        });

        const pinnedBtn = document.getElementById('kb-pinned-filter-btn');
        if (pinnedBtn) pinnedBtn.classList.toggle('active', isPinnedOnlyView);

        const calcBtn = document.getElementById('kb-calculators-btn');
        if (calcBtn) calcBtn.classList.toggle('active', isCalculatorsView);
    }

    function renderKnowledgeBaseContent() {
        const container = document.getElementById('kb-content-container');
        if (!container) return;

        if (isCalculatorsView) {
            renderCalculatorsView(container);
            return;
        }

        const allGuides = getAllGuides();
        const pinnedIds = getPinnedGuideIds();
        const q = searchQuery.trim().toLowerCase();

        let filtered = allGuides.filter(g => {
            if (isPinnedOnlyView && !pinnedIds.includes(g.id)) return false;
            if (activeCategory !== 'all' && g.category !== activeCategory) return false;

            if (q) {
                const matchTitle = g.title.toLowerCase().includes(q);
                const matchSummary = g.summary.toLowerCase().includes(q);
                const matchTags = (g.tags || []).some(t => t.toLowerCase().includes(q));
                const matchCat = (g.categoryName || '').toLowerCase().includes(q);
                return matchTitle || matchSummary || matchTags || matchCat;
            }
            return true;
        });

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="kb-empty-state glass-panel">
                    <div class="kb-empty-icon"><i class="ph ph-magnifying-glass"></i></div>
                    <h3>No Resources Found</h3>
                    <p class="text-muted">
                        ${q ? `No articles matching "${escapeHtml(q)}"` : (isPinnedOnlyView ? 'You haven\'t pinned any guides yet. Click the bookmark icon on any card to pin it.' : 'No resources in this category yet.')}
                    </p>
                    <div style="margin-top:1.25rem;display:flex;gap:0.75rem;justify-content:center;">
                        ${q ? `<button class="btn btn-secondary" id="kb-reset-search-btn"><i class="ph ph-x"></i> Clear Search</button>` : ''}
                        <button class="btn btn-primary" id="kb-view-all-btn"><i class="ph ph-squares-four"></i> View All Resources</button>
                    </div>
                </div>
            `;

            document.getElementById('kb-reset-search-btn')?.addEventListener('click', () => {
                const searchInput = document.getElementById('kb-search-input');
                if (searchInput) searchInput.value = '';
                searchQuery = '';
                document.getElementById('kb-search-clear-btn')?.classList.add('hidden');
                renderKnowledgeBaseContent();
            });

            document.getElementById('kb-view-all-btn')?.addEventListener('click', () => {
                activeCategory = 'all';
                isCalculatorsView = false;
                isPinnedOnlyView = false;
                searchQuery = '';
                const searchInput = document.getElementById('kb-search-input');
                if (searchInput) searchInput.value = '';
                document.getElementById('kb-search-clear-btn')?.classList.add('hidden');
                updatePillStates();
                renderKnowledgeBaseContent();
            });

            return;
        }

        container.innerHTML = `
            <div class="kb-results-header">
                <span class="text-sm text-muted">Showing <strong>${filtered.length}</strong> resource${filtered.length === 1 ? '' : 's'}</span>
            </div>
            <div class="kb-grid">
                ${filtered.map(guide => {
                    const isPinned = pinnedIds.includes(guide.id);
                    return `
                        <div class="kb-card glass-panel flex-col" data-id="${escapeHtml(guide.id)}">
                            <div class="kb-card-top">
                                <span class="kb-category-badge category-${escapeHtml(guide.category)}">
                                    <i class="ph ${guide.categoryIcon || 'ph-book-open'}"></i>
                                    ${escapeHtml(guide.categoryName || guide.category)}
                                </span>
                                <button class="kb-pin-btn ${isPinned ? 'pinned' : ''}" data-id="${escapeHtml(guide.id)}" title="${isPinned ? 'Unpin from quick access' : 'Pin to quick access'}" aria-label="Pin resource">
                                    <i class="ph${isPinned ? '-fill' : ''} ph-bookmark-simple"></i>
                                </button>
                            </div>
                            <h4 class="kb-card-title">${escapeHtml(guide.title)}</h4>
                            <p class="kb-card-summary">${escapeHtml(guide.summary)}</p>
                            <div class="kb-card-tags">
                                ${(guide.tags || []).slice(0, 4).map(t => `<span class="kb-tag">#${escapeHtml(t)}</span>`).join('')}
                            </div>
                            <div class="kb-card-footer">
                                <span class="kb-read-time"><i class="ph ph-clock"></i> ${escapeHtml(guide.readTime || '3 min')}</span>
                                <button class="btn btn-secondary text-sm kb-open-guide-btn" data-id="${escapeHtml(guide.id)}">
                                    Read Guide <i class="ph ph-arrow-right"></i>
                                </button>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        // Card Click Handlers
        container.querySelectorAll('.kb-open-guide-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = e.currentTarget.getAttribute('data-id');
                openGuideDetailModal(id);
            });
        });

        container.querySelectorAll('.kb-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.kb-pin-btn')) return;
                const id = card.getAttribute('data-id');
                openGuideDetailModal(id);
            });
        });

        container.querySelectorAll('.kb-pin-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = e.currentTarget.getAttribute('data-id');
                togglePinGuide(id);
            });
        });
    }

    // ==========================================
    // INTERACTIVE CALCULATORS & WORKBENCH TOOLS
    // ==========================================
    function renderCalculatorsView(container) {
        container.innerHTML = `
            <div class="kb-calc-hub">
                <div class="kb-calc-nav">
                    <button class="btn btn-secondary kb-calc-tab-btn active" data-tool="gear">
                        <i class="ph ph-gear-six"></i> Gear Ratio & Speed
                    </button>
                    <button class="btn btn-secondary kb-calc-tab-btn" data-tool="wire">
                        <i class="ph ph-lightning"></i> AWG Wire & Voltage Drop
                    </button>
                    <button class="btn btn-secondary kb-calc-tab-btn" data-tool="tap">
                        <i class="ph ph-wrench"></i> Fastener & Tap Drill Finder
                    </button>
                    <button class="btn btn-secondary kb-calc-tab-btn" data-tool="3dprint">
                        <i class="ph ph-cube"></i> 3D Filament & Slicer Specs
                    </button>
                </div>

                <!-- Tool 1: Gear Ratio & Speed -->
                <div class="kb-tool-panel" id="kb-tool-gear">
                    <div class="kb-calc-card glass-panel">
                        <div class="kb-calc-header">
                            <div>
                                <h3><i class="ph ph-gear-six"></i> Gear Ratio & Linear Drive Speed Calculator</h3>
                                <p class="text-muted text-sm">Calculate overall mechanical reduction, final shaft output RPM, and robot linear speed.</p>
                            </div>
                        </div>
                        <div class="kb-calc-grid">
                            <div class="kb-calc-inputs">
                                <div class="form-group">
                                    <label>Motor Preset</label>
                                    <select class="form-control" id="gear-motor-preset">
                                        <option value="6000" selected>Kraken X60 (6,000 RPM)</option>
                                        <option value="5676">NEO Brushless (5,676 RPM)</option>
                                        <option value="6380">Falcon 500 (6,380 RPM)</option>
                                        <option value="5330">CIM Motor (5,330 RPM)</option>
                                        <option value="18730">775pro / Redline (18,730 RPM)</option>
                                        <option value="custom">Custom Motor RPM...</option>
                                    </select>
                                </div>
                                <div class="form-group hidden" id="gear-custom-rpm-group">
                                    <label>Custom Free Speed (RPM)</label>
                                    <input type="number" class="form-control" id="gear-custom-rpm" value="6000" min="100" max="50000">
                                </div>
                                <div class="flex" style="gap:1rem;">
                                    <div class="form-group flex-1">
                                        <label>Driving Gear (Pinion Teeth)</label>
                                        <input type="number" class="form-control" id="gear-driving-teeth" value="12" min="1" max="200">
                                    </div>
                                    <div class="form-group flex-1">
                                        <label>Driven Gear (Bull Gear Teeth)</label>
                                        <input type="number" class="form-control" id="gear-driven-teeth" value="60" min="1" max="200">
                                    </div>
                                </div>
                                <div class="flex" style="gap:1rem;">
                                    <div class="form-group flex-1">
                                        <label>Second Stage Driving (Optional)</label>
                                        <input type="number" class="form-control" id="gear-driving-2" value="1" min="1" max="200">
                                    </div>
                                    <div class="form-group flex-1">
                                        <label>Second Stage Driven (Optional)</label>
                                        <input type="number" class="form-control" id="gear-driven-2" value="1" min="1" max="200">
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label>Drive Wheel Diameter (Inches)</label>
                                    <input type="number" class="form-control" id="gear-wheel-dia" value="4.0" step="0.25" min="0.5" max="24.0">
                                </div>
                            </div>

                            <div class="kb-calc-results">
                                <div class="kb-result-box highlight">
                                    <span class="kb-result-label">Overall Reduction Ratio</span>
                                    <span class="kb-result-val" id="gear-res-ratio">5.00 : 1</span>
                                    <span class="text-xs text-muted" id="gear-res-ratio-desc">5.0x Torque Multiplier</span>
                                </div>
                                <div class="kb-result-box">
                                    <span class="kb-result-label">Final Shaft Output Speed</span>
                                    <span class="kb-result-val" id="gear-res-rpm">1,200 RPM</span>
                                    <span class="text-xs text-muted">Free speed under no load</span>
                                </div>
                                <div class="kb-result-box">
                                    <span class="kb-result-label">Theoretical Linear Surface Speed</span>
                                    <span class="kb-result-val" id="gear-res-speed">20.9 ft/sec</span>
                                    <span class="text-xs text-muted" id="gear-res-speed-metric">6.38 m/s (14.3 mph)</span>
                                </div>
                                <div class="kb-result-box">
                                    <span class="kb-result-label">Estimated Real-World Speed (~82% Load)</span>
                                    <span class="kb-result-val" id="gear-res-real-speed" style="color:var(--accent-primary);">17.2 ft/sec</span>
                                    <span class="text-xs text-muted">Accounting for friction & carpet drag</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Tool 2: Wire Gauge & Voltage Drop -->
                <div class="kb-tool-panel hidden" id="kb-tool-wire">
                    <div class="kb-calc-card glass-panel">
                        <div class="kb-calc-header">
                            <div>
                                <h3><i class="ph ph-lightning"></i> AWG Wire Gauge & Voltage Drop Calculator</h3>
                                <p class="text-muted text-sm">Calculate circuit resistance, voltage loss, and verify safe ampacity for 12V DC systems.</p>
                            </div>
                        </div>
                        <div class="kb-calc-grid">
                            <div class="kb-calc-inputs">
                                <div class="form-group">
                                    <label>Circuit Nominal Voltage</label>
                                    <select class="form-control" id="wire-voltage">
                                        <option value="12" selected>12V DC (Main Robot Battery)</option>
                                        <option value="5">5V DC (Sensors / Coprocessor)</option>
                                        <option value="24">24V DC (Pneumatic / Industrial)</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Continuous Current Load (Amps)</label>
                                    <input type="number" class="form-control" id="wire-current" value="30" min="0.5" max="200" step="1">
                                </div>
                                <div class="form-group">
                                    <label>Total Wire Length (Feet, One-Way)</label>
                                    <input type="number" class="form-control" id="wire-length" value="6" min="0.5" max="100" step="0.5">
                                    <small class="text-muted">Return path (2x length) is automatically calculated.</small>
                                </div>
                                <div class="form-group">
                                    <label>Selected Wire Gauge (AWG)</label>
                                    <select class="form-control" id="wire-awg-select">
                                        <option value="6">6 AWG (Heavy Battery / Main PDP)</option>
                                        <option value="10">10 AWG (High Power Motors / 40A Breaker)</option>
                                        <option value="12" selected>12 AWG (Standard Motors / 30A Breaker)</option>
                                        <option value="14">14 AWG (Medium Load / 20A Breaker)</option>
                                        <option value="18">18 AWG (Low Power / 10A Breaker)</option>
                                        <option value="22">22 AWG (Sensors / CAN Bus)</option>
                                    </select>
                                </div>
                            </div>

                            <div class="kb-calc-results">
                                <div class="kb-result-box" id="wire-res-status-box">
                                    <span class="kb-result-label">Safety & Ampacity Rating</span>
                                    <span class="kb-result-val" id="wire-res-status" style="color:#22c55e;">Safe & Compliant</span>
                                    <span class="text-xs text-muted" id="wire-res-awg-rec">Minimum recommended: 12 AWG</span>
                                </div>
                                <div class="kb-result-box highlight">
                                    <span class="kb-result-label">Estimated Voltage Drop</span>
                                    <span class="kb-result-val" id="wire-res-vdrop">0.57 V (4.75%)</span>
                                    <span class="text-xs text-muted" id="wire-res-deliv">Delivered: 11.43 V at load</span>
                                </div>
                                <div class="kb-result-box">
                                    <span class="kb-result-label">Total Loop Resistance</span>
                                    <span class="kb-result-val" id="wire-res-ohm">0.0191 Ω (19.1 mΩ)</span>
                                    <span class="text-xs text-muted">Copper wire @ 20°C</span>
                                </div>
                                <div class="kb-result-box">
                                    <span class="kb-result-label">Power Dissipated as Heat</span>
                                    <span class="kb-result-val" id="wire-res-watts">17.2 Watts</span>
                                    <span class="text-xs text-muted">Heat generation along wire run</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Tool 3: Fastener & Tap Drill Finder -->
                <div class="kb-tool-panel hidden" id="kb-tool-tap">
                    <div class="kb-calc-card glass-panel">
                        <div class="kb-calc-header">
                            <div>
                                <h3><i class="ph ph-wrench"></i> Fastener, Tap & Clearance Drill Interactive Finder</h3>
                                <p class="text-muted text-sm">Select any screw size to view exact clearance holes, tap drills for aluminum vs steel, and required hex drivers.</p>
                            </div>
                        </div>
                        <div class="kb-calc-grid">
                            <div class="kb-calc-inputs">
                                <div class="form-group">
                                    <label>Standard Screw Size</label>
                                    <select class="form-control" id="tap-screw-select">
                                        <option value="4-40">#4-40 UNC</option>
                                        <option value="6-32">#6-32 UNC</option>
                                        <option value="8-32">#8-32 UNC</option>
                                        <option value="10-32" selected>#10-32 UNF (Robotics Standard)</option>
                                        <option value="10-24">#10-24 UNC (Coarse)</option>
                                        <option value="1/4-20">1/4"-20 UNC</option>
                                        <option value="1/4-28">1/4"-28 UNF</option>
                                        <option value="M3">M3 x 0.5 mm Metric</option>
                                        <option value="M4">M4 x 0.7 mm Metric</option>
                                        <option value="M5">M5 x 0.8 mm Metric</option>
                                        <option value="M6">M6 x 1.0 mm Metric</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Target Material Being Tapped</label>
                                    <select class="form-control" id="tap-material-select">
                                        <option value="aluminum" selected>Aluminum (6061-T6) / Soft Metals</option>
                                        <option value="steel">Steel / Hard Alloys</option>
                                        <option value="plastic">Polycarbonate / Delrin Plastic</option>
                                    </select>
                                </div>
                            </div>

                            <div class="kb-calc-results" id="tap-drill-results-wrap">
                                <!-- Injected dynamically -->
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Tool 4: 3D Filament Specs -->
                <div class="kb-tool-panel hidden" id="kb-tool-3dprint">
                    <div class="kb-calc-card glass-panel">
                        <div class="kb-calc-header">
                            <div>
                                <h3><i class="ph ph-cube"></i> 3D Printing Filament & Slicer Settings Matrix</h3>
                                <p class="text-muted text-sm">Select your component type to get recommended filament, perimeter wall counts, and nozzle temperatures.</p>
                            </div>
                        </div>
                        <div class="kb-calc-grid">
                            <div class="kb-calc-inputs">
                                <div class="form-group">
                                    <label>Component Application</label>
                                    <select class="form-control" id="filament-app-select">
                                        <option value="bracket" selected>Heavy Structural Bracket / Motor Mount</option>
                                        <option value="intake">Intake Roller / Flexible Bumper</option>
                                        <option value="sensor">Sensor Housing / Non-Load Cover</option>
                                        <option value="gear">Custom Gear / High-Stress Pulley</option>
                                        <option value="battery">Battery Retention Strap / Plate</option>
                                    </select>
                                </div>
                            </div>

                            <div class="kb-calc-results" id="filament-results-wrap">
                                <!-- Injected dynamically -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Tool Tab Switching
        container.querySelectorAll('.kb-calc-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                container.querySelectorAll('.kb-calc-tab-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                const tool = e.currentTarget.getAttribute('data-tool');

                container.querySelectorAll('.kb-tool-panel').forEach(p => p.classList.add('hidden'));
                const targetPanel = document.getElementById(`kb-tool-${tool}`);
                if (targetPanel) targetPanel.classList.remove('hidden');
            });
        });

        // Initialize Calculators Events
        initGearCalculator();
        initWireCalculator();
        initTapFinder();
        initFilamentSpecs();
    }

    // --- Calculator 1: Gear Ratio ---
    function initGearCalculator() {
        const motorPreset = document.getElementById('gear-motor-preset');
        const customRpmGroup = document.getElementById('gear-custom-rpm-group');
        const customRpm = document.getElementById('gear-custom-rpm');
        const driving1 = document.getElementById('gear-driving-teeth');
        const driven1 = document.getElementById('gear-driven-teeth');
        const driving2 = document.getElementById('gear-driving-2');
        const driven2 = document.getElementById('gear-driven-2');
        const wheelDia = document.getElementById('gear-wheel-dia');

        function recalculate() {
            let rpm = parseFloat(motorPreset?.value || '6000');
            if (motorPreset?.value === 'custom') {
                customRpmGroup?.classList.remove('hidden');
                rpm = parseFloat(customRpm?.value || '6000');
            } else {
                customRpmGroup?.classList.add('hidden');
            }

            const d1 = Math.max(1, parseFloat(driving1?.value || '12'));
            const dr1 = Math.max(1, parseFloat(driven1?.value || '60'));
            const d2 = Math.max(1, parseFloat(driving2?.value || '1'));
            const dr2 = Math.max(1, parseFloat(driven2?.value || '1'));
            const dia = Math.max(0.1, parseFloat(wheelDia?.value || '4'));

            const ratio1 = dr1 / d1;
            const ratio2 = dr2 / d2;
            const totalRatio = ratio1 * ratio2;
            const outputRpm = rpm / totalRatio;

            // Linear speed: Wheel Circumference = pi * dia (inches).
            // inches per minute = outputRpm * (pi * dia)
            // feet per second = (inches per minute) / (12 * 60)
            const circumInches = Math.PI * dia;
            const inPerMin = outputRpm * circumInches;
            const ftPerSec = inPerMin / 720;
            const metersPerSec = ftPerSec * 0.3048;
            const mph = ftPerSec * 0.681818;
            const realFtPerSec = ftPerSec * 0.82;

            document.getElementById('gear-res-ratio').textContent = `${totalRatio.toFixed(2)} : 1`;
            document.getElementById('gear-res-ratio-desc').textContent = `${totalRatio.toFixed(2)}x Mechanical Advantage / Torque Multiplier`;
            document.getElementById('gear-res-rpm').textContent = `${Math.round(outputRpm).toLocaleString()} RPM`;
            document.getElementById('gear-res-speed').textContent = `${ftPerSec.toFixed(1)} ft/sec`;
            document.getElementById('gear-res-speed-metric').textContent = `${metersPerSec.toFixed(2)} m/s (${mph.toFixed(1)} mph)`;
            document.getElementById('gear-res-real-speed').textContent = `${realFtPerSec.toFixed(1)} ft/sec`;
        }

        [motorPreset, customRpm, driving1, driven1, driving2, driven2, wheelDia].forEach(el => {
            el?.addEventListener('input', recalculate);
            el?.addEventListener('change', recalculate);
        });

        recalculate();
    }

    // --- Calculator 2: Wire Gauge & Voltage Drop ---
    function initWireCalculator() {
        const vInput = document.getElementById('wire-voltage');
        const cInput = document.getElementById('wire-current');
        const lInput = document.getElementById('wire-length');
        const awgSelect = document.getElementById('wire-awg-select');

        // Resistance in Ohms per 1000 ft (annealed copper at 20°C)
        const AWG_RESISTANCE = {
            '6': 0.3951,
            '10': 0.9989,
            '12': 1.588,
            '14': 2.525,
            '18': 6.385,
            '22': 16.14
        };

        // Max continuous ampacity limits for typical chassis wiring
        const AWG_MAX_AMPS = {
            '6': 80,
            '10': 45,
            '12': 30,
            '14': 20,
            '18': 10,
            '22': 3
        };

        function recalculate() {
            const v = parseFloat(vInput?.value || '12');
            const amps = Math.max(0.1, parseFloat(cInput?.value || '30'));
            const lenFeet = Math.max(0.1, parseFloat(lInput?.value || '6'));
            const awg = awgSelect?.value || '12';

            const totalWireRunFeet = lenFeet * 2; // out and back
            const resPer1000 = AWG_RESISTANCE[awg] || 1.588;
            const loopResistance = (resPer1000 / 1000) * totalWireRunFeet;
            const vDrop = amps * loopResistance;
            const pctDrop = (vDrop / v) * 100;
            const deliveredV = Math.max(0, v - vDrop);
            const wattsHeat = amps * vDrop;

            const maxAmp = AWG_MAX_AMPS[awg] || 30;
            const statusEl = document.getElementById('wire-res-status');
            const awgRecEl = document.getElementById('wire-res-awg-rec');

            // Find recommended minimum AWG for this current
            let recAwg = '6';
            if (amps <= 3) recAwg = '22';
            else if (amps <= 10) recAwg = '18';
            else if (amps <= 20) recAwg = '14';
            else if (amps <= 30) recAwg = '12';
            else if (amps <= 45) recAwg = '10';

            if (amps > maxAmp) {
                statusEl.textContent = `Hazard: Overload! (Max ${maxAmp}A for ${awg} AWG)`;
                statusEl.style.color = '#ef4444';
            } else if (pctDrop > 6.0) {
                statusEl.textContent = `Warning: Excessive Voltage Drop (${pctDrop.toFixed(1)}%)`;
                statusEl.style.color = '#f59e0b';
            } else {
                statusEl.textContent = `Safe & Compliant (${maxAmp}A limit)`;
                statusEl.style.color = '#22c55e';
            }

            awgRecEl.textContent = `Recommended for ${amps}A load: ${recAwg} AWG or heavier`;
            document.getElementById('wire-res-vdrop').textContent = `${vDrop.toFixed(2)} V (${pctDrop.toFixed(1)}%)`;
            document.getElementById('wire-res-deliv').textContent = `Delivered to load: ${deliveredV.toFixed(2)} V`;
            document.getElementById('wire-res-ohm').textContent = `${loopResistance.toFixed(4)} Ω (${(loopResistance * 1000).toFixed(1)} mΩ)`;
            document.getElementById('wire-res-watts').textContent = `${wattsHeat.toFixed(1)} Watts`;
        }

        [vInput, cInput, lInput, awgSelect].forEach(el => {
            el?.addEventListener('input', recalculate);
            el?.addEventListener('change', recalculate);
        });

        recalculate();
    }

    // --- Calculator 3: Tap Finder ---
    const TAP_DATA = {
        '4-40': {
            major: '0.112" (2.84mm)',
            clearance: '#32 (0.116") / 2.95mm',
            tapAlum: '#43 (0.089") / 2.26mm',
            tapSteel: '#42 (0.0935")',
            driver: '3/32" Hex (SHCS) / #1 Phillips',
            tpi: '40 Threads / inch (UNC Coarse)'
        },
        '6-32': {
            major: '0.138" (3.51mm)',
            clearance: '#27 (0.144") / 3.66mm',
            tapAlum: '#36 (0.1065") / 2.70mm',
            tapSteel: '#35 (0.110")',
            driver: '7/64" Hex / #2 Phillips',
            tpi: '32 Threads / inch (UNC Coarse)'
        },
        '8-32': {
            major: '0.164" (4.17mm)',
            clearance: '#18 (0.170") / 4.31mm',
            tapAlum: '#29 (0.136") / 3.45mm',
            tapSteel: '#28 (0.1405")',
            driver: '9/64" Hex / 3/32" (BHCS)',
            tpi: '32 Threads / inch (UNC Coarse)'
        },
        '10-32': {
            major: '0.190" (4.83mm)',
            clearance: '#7 (0.201") or 13/64" (5.10mm)',
            tapAlum: '#21 (0.159") or 5/32" (3.97mm)',
            tapSteel: '#20 (0.161")',
            driver: '5/32" Hex (SHCS) / 1/8" Hex (BHCS)',
            tpi: '32 Threads / inch (UNF Fine) - FRC STANDARD'
        },
        '10-24': {
            major: '0.190" (4.83mm)',
            clearance: '#7 (0.201")',
            tapAlum: '#25 (0.1495") / 3.80mm',
            tapSteel: '#24 (0.152")',
            driver: '5/32" Hex (SHCS)',
            tpi: '24 Threads / inch (UNC Coarse)'
        },
        '1/4-20': {
            major: '0.250" (6.35mm)',
            clearance: 'Letter F (0.257") or 17/64"',
            tapAlum: '#7 (0.201") or 13/64" (5.10mm)',
            tapSteel: '#6 (0.204")',
            driver: '3/16" Hex (SHCS) / 5/32" (BHCS)',
            tpi: '20 Threads / inch (UNC Coarse)'
        },
        '1/4-28': {
            major: '0.250" (6.35mm)',
            clearance: 'Letter F (0.257")',
            tapAlum: '#3 (0.213") or 7/32"',
            tapSteel: '7/32" (0.2188")',
            driver: '3/16" Hex',
            tpi: '28 Threads / inch (UNF Fine)'
        },
        'M3': {
            major: '3.00mm (0.118")',
            clearance: '3.1mm or 1/8" (0.125")',
            tapAlum: '2.5mm (#39)',
            tapSteel: '2.5mm',
            driver: '2.5mm Hex',
            tpi: '0.50 mm pitch (Metric Standard)'
        },
        'M4': {
            major: '4.00mm (0.157")',
            clearance: '4.2mm (#19)',
            tapAlum: '3.3mm (#30)',
            tapSteel: '3.3mm',
            driver: '3.0mm Hex',
            tpi: '0.70 mm pitch (Metric Standard)'
        },
        'M5': {
            major: '5.00mm (0.197")',
            clearance: '5.2mm (#8)',
            tapAlum: '4.2mm (#19)',
            tapSteel: '4.2mm',
            driver: '4.0mm Hex',
            tpi: '0.80 mm pitch (Metric Standard)'
        },
        'M6': {
            major: '6.00mm (0.236")',
            clearance: '6.2mm (Letter D) or 1/4"',
            tapAlum: '5.0mm (#9)',
            tapSteel: '5.0mm',
            driver: '5.0mm Hex',
            tpi: '1.00 mm pitch (Metric Standard)'
        }
    };

    function initTapFinder() {
        const screwSelect = document.getElementById('tap-screw-select');
        const matSelect = document.getElementById('tap-material-select');
        const resultsWrap = document.getElementById('tap-drill-results-wrap');

        function update() {
            const screw = screwSelect?.value || '10-32';
            const data = TAP_DATA[screw] || TAP_DATA['10-32'];
            const mat = matSelect?.value || 'aluminum';

            const tapDrill = mat === 'steel' ? data.tapSteel : data.tapAlum;

            resultsWrap.innerHTML = `
                <div class="kb-result-box highlight">
                    <span class="kb-result-label">Recommended Tap Drill Size</span>
                    <span class="kb-result-val" style="color:var(--accent-primary);">${data.tapAlum}</span>
                    <span class="text-xs text-muted">Yields 75% thread engagement in ${mat}</span>
                </div>
                <div class="kb-result-box">
                    <span class="kb-result-label">Clearance (Through-Hole) Drill</span>
                    <span class="kb-result-val">${data.clearance}</span>
                    <span class="text-xs text-muted">Free slip-fit through mounting plates</span>
                </div>
                <div class="kb-result-box">
                    <span class="kb-result-label">Screw Major Diameter</span>
                    <span class="kb-result-val">${data.major}</span>
                    <span class="text-xs text-muted">${data.tpi}</span>
                </div>
                <div class="kb-result-box">
                    <span class="kb-result-label">Allen Key / Driver Size</span>
                    <span class="kb-result-val">${data.driver}</span>
                    <span class="text-xs text-muted">Standard Socket Head Cap Screw</span>
                </div>
            `;
        }

        screwSelect?.addEventListener('change', update);
        matSelect?.addEventListener('change', update);
        update();
    }

    // --- Calculator 4: 3D Filament Specs ---
    const FILAMENT_SPECS = {
        'bracket': {
            material: 'PA-CF (Nylon Carbon Fiber) or PETG',
            walls: '5 - 6 Perimeters (Walls)',
            infill: '35% - 45% Gyroid',
            nozzleTemp: '270°C - 290°C (Nylon-CF) / 240°C (PETG)',
            bedTemp: '80°C - 100°C',
            cooling: 'Off or Low (20%) for maximum layer bonding',
            tips: 'Use hardened steel nozzle. Press in brass heat-set threaded inserts at 230°C.'
        },
        'intake': {
            material: 'TPU 95A / 85A Flexible',
            walls: '3 - 4 Perimeters',
            infill: '15% - 25% Gyroid (Adjust for grip softness)',
            nozzleTemp: '220°C - 235°C',
            bedTemp: '50°C - 60°C',
            cooling: '50% Fan',
            tips: 'Print slow (20-30 mm/s) with direct drive. Indestructible on intake rollers.'
        },
        'sensor': {
            material: 'PLA+ / Tough PLA',
            walls: '3 Perimeters',
            infill: '20% Gyroid or Grid',
            nozzleTemp: '205°C - 215°C',
            bedTemp: '55°C - 60°C',
            cooling: '100% Fan for crisp overhangs',
            tips: 'Fastest to print. Avoid mounting directly touching hot motor cases.'
        },
        'gear': {
            material: 'PACF / Nylon 12 / Delrin',
            walls: '8 Perimeters (Solid Tooth Profile)',
            infill: '60% Cubic',
            nozzleTemp: '280°C',
            bedTemp: '90°C with glue stick',
            cooling: 'Low fan',
            tips: 'Dry filament in dehydrator for 6 hours prior to printing to prevent bubbles.'
        },
        'battery': {
            material: 'PETG or Polycarbonate',
            walls: '5 Perimeters',
            infill: '40% Gyroid',
            nozzleTemp: '245°C (PETG) / 290°C (PC)',
            bedTemp: '80°C - 110°C',
            cooling: 'Low cooling',
            tips: 'PETG resists acid and flexes on heavy robot impacts without shattering.'
        }
    };

    function initFilamentSpecs() {
        const appSelect = document.getElementById('filament-app-select');
        const resultsWrap = document.getElementById('filament-results-wrap');

        function update() {
            const key = appSelect?.value || 'bracket';
            const spec = FILAMENT_SPECS[key] || FILAMENT_SPECS['bracket'];

            resultsWrap.innerHTML = `
                <div class="kb-result-box highlight">
                    <span class="kb-result-label">Recommended Material</span>
                    <span class="kb-result-val" style="color:var(--accent-primary);">${spec.material}</span>
                    <span class="text-xs text-muted">${spec.tips}</span>
                </div>
                <div class="kb-result-box">
                    <span class="kb-result-label">Perimeters & Infill Settings</span>
                    <span class="kb-result-val">${spec.walls}</span>
                    <span class="text-xs text-muted">Infill: <strong>${spec.infill}</strong></span>
                </div>
                <div class="kb-result-box">
                    <span class="kb-result-label">Nozzle & Bed Temperatures</span>
                    <span class="kb-result-val">${spec.nozzleTemp}</span>
                    <span class="text-xs text-muted">Bed: ${spec.bedTemp} | Cooling: ${spec.cooling}</span>
                </div>
            `;
        }

        appSelect?.addEventListener('change', update);
        update();
    }

    // ==========================================
    // GUIDE DETAIL MODAL
    // ==========================================
    function openGuideDetailModal(guideId) {
        const allGuides = getAllGuides();
        const guide = allGuides.find(g => g.id === guideId);
        if (!guide) return;

        const pinnedIds = getPinnedGuideIds();
        const isPinned = pinnedIds.includes(guide.id);

        const modalHtml = `
            <div class="kb-modal-wrapper">
                <div class="modal-header kb-modal-header">
                    <div>
                        <div class="flex" style="align-items:center;gap:0.5rem;margin-bottom:0.35rem;">
                            <span class="kb-category-badge category-${escapeHtml(guide.category)}">
                                <i class="ph ${guide.categoryIcon || 'ph-book-open'}"></i>
                                ${escapeHtml(guide.categoryName || guide.category)}
                            </span>
                            <span class="text-xs text-muted"><i class="ph ph-clock"></i> ${escapeHtml(guide.readTime || '3 min')}</span>
                        </div>
                        <h2 style="margin:0;font-size:1.35rem;font-weight:700;">${escapeHtml(guide.title)}</h2>
                    </div>
                    <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
                </div>

                <div class="modal-body kb-modal-body">
                    <div class="kb-guide-content">
                        ${guide.content}
                    </div>

                    ${(guide.tags && guide.tags.length > 0) ? `
                        <div class="kb-modal-tags" style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--glass-border);display:flex;gap:0.4rem;flex-wrap:wrap;">
                            ${guide.tags.map(t => `<span class="kb-tag">#${escapeHtml(t)}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>

                <div class="modal-footer kb-modal-footer">
                    <div class="flex" style="gap:0.5rem;">
                        <button class="btn btn-secondary text-sm" id="kb-modal-pin-btn" data-id="${escapeHtml(guide.id)}">
                            <i class="ph${isPinned ? '-fill' : ''} ph-bookmark-simple"></i>
                            ${isPinned ? 'Pinned' : 'Pin to Quick Access'}
                        </button>
                        <button class="btn btn-secondary text-sm" id="kb-modal-print-btn">
                            <i class="ph ph-printer"></i> Print / Save PDF
                        </button>
                    </div>
                    <button class="btn btn-primary text-sm" onclick="closeModal()">
                        Done
                    </button>
                </div>
            </div>
        `;

        if (typeof openModal === 'function') {
            openModal(modalHtml);
        }

        const dynamicModal = document.getElementById('dynamic-modal');
        if (dynamicModal) {
            dynamicModal.classList.add('kb-reader-modal');
        }

        document.getElementById('kb-modal-pin-btn')?.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            togglePinGuide(id);
            const isNowPinned = getPinnedGuideIds().includes(id);
            e.currentTarget.innerHTML = `
                <i class="ph${isNowPinned ? '-fill' : ''} ph-bookmark-simple"></i>
                ${isNowPinned ? 'Pinned' : 'Pin to Quick Access'}
            `;
            if (typeof showToast === 'function') {
                showToast(isNowPinned ? 'Guide pinned to quick access' : 'Guide unpinned', 'info');
            }
        });

        document.getElementById('kb-modal-print-btn')?.addEventListener('click', () => {
            window.print();
        });
    }

    // ==========================================
    // ADD CUSTOM GUIDE MODAL (FOR TEACHERS / MENTORS)
    // ==========================================
    function openAddCustomGuideModal() {
        const modalHtml = `
            <div class="kb-modal-wrapper">
                <div class="modal-header">
                    <div>
                        <h2 style="margin:0;font-size:1.25rem;"><i class="ph ph-plus-circle"></i> Add Custom Lab Resource</h2>
                        <p class="text-xs text-muted" style="margin:0.2rem 0 0;">Create a school or lab-specific guide for machine operation, safety, or storage.</p>
                    </div>
                    <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
                </div>

                <div class="modal-body">
                    <form id="kb-custom-guide-form" style="display:flex;flex-direction:column;gap:0.85rem;">
                        <div class="form-group">
                            <label>Guide Title *</label>
                            <input type="text" class="form-control" id="kb-form-title" required placeholder="e.g. CNC Router Safe Startup & Tool Offset Checklist">
                        </div>

                        <div class="flex" style="gap:1rem;">
                            <div class="form-group flex-1">
                                <label>Category</label>
                                <select class="form-control" id="kb-form-category">
                                    <option value="machining">Shop Tools & Machining</option>
                                    <option value="robotics">Robotics & Mechanisms</option>
                                    <option value="electronics">Electronics & Wiring</option>
                                    <option value="3dprint">3D Printing & CAD</option>
                                    <option value="programming">Programming & Control</option>
                                    <option value="safety">Safety & Protocols</option>
                                    <option value="links">External Links</option>
                                </select>
                            </div>
                            <div class="form-group flex-1">
                                <label>Est. Read Time</label>
                                <input type="text" class="form-control" id="kb-form-readtime" value="3 min read">
                            </div>
                        </div>

                        <div class="form-group">
                            <label>Short Summary *</label>
                            <input type="text" class="form-control" id="kb-form-summary" required placeholder="A brief one-line description visible on the card...">
                        </div>

                        <div class="form-group">
                            <label>Tags (Comma-separated)</label>
                            <input type="text" class="form-control" id="kb-form-tags" placeholder="CNC, Router, Safety, Carbide, Zeroing">
                        </div>

                        <div class="form-group">
                            <label>Guide Content (HTML Supported) *</label>
                            <textarea class="form-control" id="kb-form-content" rows="8" required placeholder="<h3>1. Startup Steps</h3><p>Ensure exhaust is on...</p>"></textarea>
                        </div>
                    </form>
                </div>

                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button class="btn btn-primary" id="kb-save-guide-btn">Save Resource</button>
                </div>
            </div>
        `;

        if (typeof openModal === 'function') {
            openModal(modalHtml);
        }

        document.getElementById('kb-save-guide-btn')?.addEventListener('click', () => {
            const form = document.getElementById('kb-custom-guide-form');
            if (!form?.checkValidity()) {
                form?.reportValidity();
                return;
            }

            const title = document.getElementById('kb-form-title')?.value.trim();
            const cat = document.getElementById('kb-form-category')?.value || 'machining';
            const readTime = document.getElementById('kb-form-readtime')?.value.trim() || '3 min read';
            const summary = document.getElementById('kb-form-summary')?.value.trim();
            const tagsRaw = document.getElementById('kb-form-tags')?.value || '';
            const content = document.getElementById('kb-form-content')?.value.trim();

            const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
            const catObj = CATEGORIES.find(c => c.id === cat) || { label: 'General', icon: 'ph-book-open' };

            const newGuide = {
                id: `custom-${Date.now()}`,
                title,
                category: cat,
                categoryName: catObj.label,
                categoryIcon: catObj.icon,
                readTime,
                tags,
                summary,
                content: content.startsWith('<') ? content : `<p>${escapeHtml(content).replace(/\n/g, '<br>')}</p>`,
                isCustom: true
            };

            saveCustomGuide(newGuide);
            if (typeof closeModal === 'function') closeModal();
            if (typeof showToast === 'function') showToast('Custom guide saved successfully!', 'success');
        });
    }

    // ==========================================
    // INITIALIZATION & EVENT HOOKS
    // ==========================================
    function initKnowledgeBaseUI() {
        const searchInput = document.getElementById('kb-search-input');
        const clearSearchBtn = document.getElementById('kb-search-clear-btn');
        const pinnedFilterBtn = document.getElementById('kb-pinned-filter-btn');
        const calculatorsBtn = document.getElementById('kb-calculators-btn');
        const addGuideBtn = document.getElementById('kb-add-guide-btn');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                searchQuery = e.target.value;
                if (clearSearchBtn) {
                    clearSearchBtn.classList.toggle('hidden', !searchQuery);
                }
                renderKnowledgeBaseContent();
            });
        }

        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                if (searchInput) searchInput.value = '';
                searchQuery = '';
                clearSearchBtn.classList.add('hidden');
                renderKnowledgeBaseContent();
            });
        }

        if (pinnedFilterBtn) {
            pinnedFilterBtn.addEventListener('click', () => {
                isPinnedOnlyView = !isPinnedOnlyView;
                isCalculatorsView = false;
                updatePillStates();
                renderKnowledgeBaseContent();
            });
        }

        if (calculatorsBtn) {
            calculatorsBtn.addEventListener('click', () => {
                isCalculatorsView = !isCalculatorsView;
                isPinnedOnlyView = false;
                updatePillStates();
                renderKnowledgeBaseContent();
            });
        }

        if (addGuideBtn) {
            addGuideBtn.addEventListener('click', openAddCustomGuideModal);
        }
    }

    function renderKnowledgeBase() {
        renderCategoryPills();
        updatePinnedBadgeCount();
        updatePillStates();
        initKnowledgeBaseUI();

        // Update Teacher/Staff Add Custom Guide button visibility
        const addGuideBtn = document.getElementById('kb-add-guide-btn');
        if (addGuideBtn) {
            const role = (typeof currentUser !== 'undefined' && currentUser?.role) ? String(currentUser.role).toLowerCase() : '';
            const canAdd = ['teacher', 'developer', 'admin', 'mentor'].includes(role);
            addGuideBtn.classList.toggle('hidden', !canAdd);
        }

        renderKnowledgeBaseContent();
    }

    // Helper: HTML escaper fallback
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Export to global scope
    window.renderKnowledgeBase = renderKnowledgeBase;
    window.renderKnowledgeBaseSkeleton = renderKnowledgeBaseSkeleton;
    window.openGuideDetailModal = openGuideDetailModal;
    window.openAddCustomGuideModal = openAddCustomGuideModal;
})();

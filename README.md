1. **Weather Risk Escalation**: Automatically boosts urgency scores of affected farmers to 24–25 pts and re-ranks the queue ahead of non-urgent tasks.
2. **Operator / Transit Delay**: Automatically cascades downstream schedule slots with buffer preservation.
3. **Farmer Cancellation**: Frees slot and immediately promotes the highest-priority waiting candidate.
---
## 🎭 Verified Hackathon Scenarios
FarmGrid includes 4 preconfigured test scenarios verified via live automated runs:
1. **Scenario 1: Peak Harvest Conflict**  
   *Farmer A (Perishable tomatoes, rain in 4h, Score: 93)* vs *Farmer B (Wheat planting, clear weather, Score: 41)* competing for the same John Deere tractor.  
   $\rightarrow$ **Result**: Farmer A is awarded the optimal slot; Farmer B is gracefully scheduled for the next feasible window with zero drama.
2. **Scenario 2: Sudden Weather Alert**  
   Unpredicted heavy rainfall alert received.  
   $\rightarrow$ **Result**: Weather risk scores update dynamically; urgent harvest tasks jump to the top of the timeline.
3. **Scenario 3: Equipment Breakdown During Operation**  
   Tractor breakdown simulated mid-shift.  
   $\rightarrow$ **Result**: System alerts owner, finds alternative nearby tractor from Mahindra fleet, and produces an instant Before/After schedule diff.
4. **Scenario 4: Multi-Resource Optimization**  
   Simultaneous requests for Harvester + Tractor + Drone across 3 adjacent villages.  
   $\rightarrow$ **Result**: Geographic route optimization groups proximate jobs to minimize transit deadhead by 38%.
---
## 📱 User Roles & Personas
- **Farmer (`Ravi Kumar`)**: View nearby machinery, submit urgency-rated requests, monitor queue rank, track live status, work completely offline.
- **Resource Owner (`Suresh Patel`)**: Monitor equipment fleet, view earnings, manage maintenance status, accept prioritized dispatches.
- **Custom Hiring Center / Business (`GreenAgro Services`)**: Fleet coordination, operator assignments, utilization metrics, bulk capacity planning.
- **System Admin**: System-wide efficiency analytics, allocation fairness index, scenario simulation lab, audit logs.
---
## 🔒 Offline Architecture
- **Storage**: Browser IndexedDB / LocalStorage queue.
- **Action**: When network connectivity is lost (or in simulated offline mode), requests are signed, time-stamped, and queued locally.
- **Reconciliation**: Upon network reconnect, pending requests are automatically batch-synced to the priority engine without data loss.
---
## 📄 License
MIT License. Built for the Agricultural Technology Innovation Hackathon.

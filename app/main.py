

from fastapi import FastAPI, HTTPException
from app.models import TourCreate, Tour

# ---------- 2. Create the app ----------
app = FastAPI(title="TourVault")




# ---------- 4. In-memory storage (replaced by PostgreSQL on Day 2) ----------
tours = []
next_id = 1 # starting at 1




# ---------- 5. Routes ----------
@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/tours", status_code=201, response_model=Tour)
def create_tour(tour: TourCreate):
    global next_id
    new_tour = Tour(id=next_id, **tour.model_dump())
    tours.append(new_tour)
    next_id += 1
    return new_tour

# TODO: GET /tours
#       return the whole list
@app.get("/tours", response_model=list[Tour])
def get_tours():
    return tours


@app.get("/tours/{tour_id}", response_model=Tour)
def get_tour(tour_id: int):
    for tour in tours:
        if tour.id == tour_id:
            return tour
    raise HTTPException(status_code=404, detail="Tour not found")



# ---------- Done when ----------
# [ ] /health returns {"status": "ok"}
# [ ] POST /tours with valid data returns 201
# [ ] POST /tours with title: 123 or a missing field -> which status code? why?
# [ ] GET /tours/999 returns 404
# [ ] committed and pushed

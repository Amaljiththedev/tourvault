from pydantic import BaseModel
class TourCreate(BaseModel):
    hospital: str
    title: str
    status: str

class Tour(BaseModel):
    id: int
    hospital: str
    title: str
    status: str


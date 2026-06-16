import requests
from typing import List, Dict, Any

from app.core import singleton

BASE_URL = "https://fulfillment.merchize.com"
X_API_KEY = "19e44715-7743-5e02-a66e-9ce064ee5cd1"
API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjYzZTQ3YmRlMjlhNjc5MTA4MDJmMWYxZSIsInVzZXJuYW1lIjoibmdhbnFAZm9vYmxhLmNvbSIsInJvbGVzIjpbeyJfaWQiOiI2NThlNmE2ZWJjZTdhNmE0YWYyMWU4OWQiLCJuYW1lIjoiZmFjX2FkbWluIn0seyJfaWQiOiI2NThlNmM4YmJjZTdhNmE0YWYyZmVkYTQiLCJuYW1lIjoiZmZtX2FkbWluIn1dLCJpc19hZG1pbiI6ZmFsc2UsImRlcGFydG1lbnQiOnsiX2lkIjoiNjU4ZThlMzBlMDVmNWU1ZTk2Y2ZmYzQ4Iiwia2V5IjoiRkZNIiwibmFtZSI6IkZ1bGZpbGxtZW50IiwiY3JlYXRlZF9hdCI6IjIwMjMtMTItMjlUMDk6MTU6MjguODU5WiIsInVwZGF0ZWRfYXQiOiIyMDIzLTEyLTI5VDA5OjE1OjI4Ljg1OVoiLCJfX3YiOjB9LCJwZXJtaXNzaW9ucyI6eyJiYXRjaF9ydWxlX21hbmFnZW1lbnQiOiJNYW5hZ2UgYXV0byBjcmVhdGUgYmF0Y2ggcnVsZXMiLCJnZXRfYnJhbmRfdGFnIjoiR2V0IGJyYW5kIHRhZyIsInVwZGF0ZV9icmFuZCI6InVwZGF0ZSBicmFuZCIsImNyZWF0ZV9icmFuZCI6IkNyZWF0ZSBicmFuZCIsImJhc2VfY29zdF9tYW5hZ2VtZW50IjoiRkFDIGJhc2UgY29zdCBtYW5hZ2VtZW50IiwidXNlcl9hY3Rpb25fbWFuYWdlbWVudCI6IlVzZXIgYWN0aW9uIG1hbmFnZW1lbnQiLCJyb2xlX21hbmFnZW1lbnQiOiJSb2xlIG1hbmFnZW1lbnQiLCJwZXJtaXNzaW9uX21hbmFnZW1lbnQiOiJQZXJtaXNzaW9uIG1hbmFnZW1lbnQiLCJ1c2VyX21hbmFnZW1lbnQiOiJVc2VyIG1hbmFnZW1lbnQiLCJyZXF1ZXN0X3VwZGF0ZSI6IlJlcXVlc3QgdXBkYXRlIiwiZmFjX3VzZXJfbWFuYWdlbWVudCI6IkZBQyB1c2VyIG1hbmFnZW1lbnQiLCJmYWNfcm9sZV9tYW5hZ2VtZW50IjoiRkFDIHJvbGUgbWFuYWdlbWVudCIsImZhY19wZXJtaXNzaW9uX21hbmFnZW1lbnQiOiJGQUMgcGVybWlzc2lvbiBtYW5hZ2VtZW50IiwiZmFjX2NvbmZpcm1fZmZtX2lzc3VlIjoiRkFDIGNvbmZpcm0gZmZtIGlzc3VlIiwiZmZtX2lzc3VlX2xpc3QiOiJGRk0gbGlzdCBpc3N1ZXMiLCJmZm1fdmlld19pc3N1ZV9yZXBvcnQiOiJGRk0gdmlldyBpc3N1ZSByZXBvcnQifSwiaWF0IjoxNzc5ODY1NTc0LCJleHAiOjE3ODI0NTc1NzR9.zrBH3WaAxNaODYDpDFX17P5DBMbOGMJmNsYFuuvmrTw"

@singleton
class APIService:
    def __init__(self):
        print("[APIService] __init__")
        self.headers = {
            "Content-Type": "application/json",
            # "x-api-key": X_API_KEY,
            "Authorization": f"Bearer {API_TOKEN}",
        }
        self.session = requests.Session()
        self.session.headers.update(self.headers)

    def list_jobs(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        if not payload:
            raise ValueError("Payload must not be empty")

        url = f"{BASE_URL}/api/order/printing-files/search"
        response = self.session.post(url, json=payload)
        response.raise_for_status()
        json_response = response.json()
        return json_response.get("data", {}).get("items", [])

    def convert_dtx(self, item, retry_job: bool):
        product_type = item.get("variant_data", {}).get("product_type", "")
        if not product_type.endswith("_PET"):
            print(
                f"❌ Item {item.get('name')}_{item.get('item_number')}: not a PET product, skipping conversion"
            )
            return

        tags = item.get("tags", [])
        if "DTG_2_DTF" in tags:
            print(
                f"✅ Item {item.get('name')}_{item.get('item_number')}: already converted to DTX, skipping"
            )
            return

        item_id = item.get("_id")
        name = item.get("name")
        item_number = item.get("item_number")
        artworks = item.get("artworks", [])

        url = f"{BASE_URL}/api/order/printing-files/items/{item_id}/convert-item-to-dtx"
        payload = {
            "artworks": artworks,
        }
        response = self.session.put(url, json=payload)
        response.raise_for_status()
        json_response = response.json()
        success = json_response.get("success")
        if success:
            print(f"✅ Item {name}_{item_number}: successfully converted to DTX")
            if retry_job:
                self.retry_job(item)
        else:
            print(f"❌ Item {name}_{item_number}: conversion to DTX failed")

    def change_type(
        self, item, retry_job: bool, add_prefix: str = None, remove_prefix: str = None, updated_product_type: str = None
    ):
        item_id = item.get("_id")
        name = item.get("name")
        item_number = item.get("item_number")
        product_type = item.get("variant_data", {}).get("product_type", "")
        front = item.get("design_front", None)
        back = item.get("design_back", None)
        sleeves = item.get("design_sleeves", None)
        hood = item.get("design_hood", None)

        if add_prefix:
            if not product_type.startswith(add_prefix):
                updated_product_type = f"{add_prefix}{product_type}"

        if remove_prefix:
            if product_type.startswith(remove_prefix):
                updated_product_type = product_type[len(remove_prefix) :]

        if not updated_product_type:
            print(f"❌ Item {name}_{item_number}: no change in product type, skipping")
            return

        url = f"{BASE_URL}/api/order/fulfillment-items/printing-files/{item_id}/designs"
        payload = {
            "front": front,
            "back": back,
            "sleeves": sleeves,
            "hood": hood,
            "type": updated_product_type,
        }

        response = self.session.post(url, json=payload)
        response.raise_for_status()
        json_response = response.json()
        success = json_response.get("success")
        if success:
            print(
                f"✅ Item {name}_{item_number}: successfully changed type to {updated_product_type}"
            )
            if retry_job:
                self.retry_job(item)
        else:
            print(
                f"❌ Item {name}_{item_number}: changing type to {updated_product_type} failed"
            )

    def retry_job(self, item):
        name = item.get("name")
        item_number = item.get("item_number")
        item_id = item.get("_id")
        fulfillment_id = item.get("fulfillment")
        url = f"{BASE_URL}/api/order/printing-files/{fulfillment_id}/items/{item_id}/status/retry"
        response = self.session.put(url)
        response.raise_for_status()
        json_response = response.json()
        success = json_response.get("success")
        if success:
            print(f"✅ Item {name}_{item_number}: retry job")
        else:
            print(f"❌ Item {name}_{item_number}: retry job failed")

    def list_supplier(self) -> List[Dict[str, Any]]:
        url = f"{BASE_URL}/api/supplier/v2/suppliers?active&limit=1000&page=1"
        response = self.session.get(url)
        response.raise_for_status()
        json_response = response.json()
        return json_response.get("data", {}).get("suppliers", [])

    def get_product_type(self, type: str) -> List[Dict[str, Any]]:
        url = f"{BASE_URL}/api/product/products/search"
        payload = {
            "page": 1,
            "limit": 20,
            "term": "",
            "category": "",
            "product_label": "",
            "type": type,
            "currency": "",
            "sku_prefix": "",
            "available_tiktok": "",
        }

        response = self.session.post(url, json=payload)
        response.raise_for_status()
        json_response = response.json()
        products = json_response.get("data", {}).get("products", [])
        for product in products:
            product_type = product.get("type", "")
            if product_type == type:
                return product

        raise ValueError(f"Product type '{type}' not found")

    def dict_variants(
        self,
        type: str,
        partner_skus: List[str],
        supplier_id: str,
        supplier_prefix: str,
    ) -> List[Dict[str, Any]]:
        product = self.get_product_type(type)
        product_id = product.get("_id")
        url = f"{BASE_URL}/api/product/products/{product_id}/variants/{supplier_id}"
        response = self.session.get(url)
        response.raise_for_status()
        json_response = response.json()
        variants = json_response.get("data", [])
        dict_variants = {}
        for variant in variants:
            partner_sku = variant.get("partner_sku", "")
            if partner_sku in partner_skus:
                _id = variant.get("_id", "")
                as_quantity = variant.get("as_quantity", 1)
                if not _id:
                    print(
                        f"❌ Variant {partner_sku} is missing _id in type '{type}' with supplier '{supplier_prefix}'"
                    )
                    continue
                dict_variants[partner_sku] = {"_id": _id, "as_quantity": as_quantity}
            
            sku = variant.get("sku", "")
            if sku in partner_skus:
                _id = variant.get("_id", "")
                as_quantity = variant.get("as_quantity", 1)
                if not _id:
                    print(
                        f"❌ Variant {sku} is missing _id in type '{type}' with supplier '{supplier_prefix}'"
                    )
                    continue
                dict_variants[sku] = {"_id": _id, "as_quantity": as_quantity}

        for partner_sku in partner_skus:
            if partner_sku not in dict_variants:
                print(
                    f"❌ Variant {partner_sku} not found in type '{type}' with supplier '{supplier_prefix}'"
                )

        return dict_variants

    def list_packages(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        if not payload:
            raise ValueError("Payload must not be empty")

        url = f"{BASE_URL}/api/order/fulfillments/search-v2"
        response = self.session.post(url, json=payload)
        response.raise_for_status()
        json_response = response.json()
        return json_response.get("data", {}).get("fulfillments", [])
    
    def detail_package(self, package_id: str) -> Dict[str, Any]:
        if not package_id:
            raise ValueError("Package ID must not be empty")

        url = f"{BASE_URL}/api/order/v2/fulfillments/{package_id}"
        response = self.session.get(url)
        response.raise_for_status()
        json_response = response.json()
        return json_response.get("data", {})
    
    def create_replace_package(self, package_id: str, payload: Dict[str, Any], package_name: str) -> Dict[str, Any]:
        if not package_id or not payload:
            raise ValueError("Package ID and payload must not be empty")

        url = f"{BASE_URL}/api/order/fulfillment/{package_id}/create-replace-package"
        response = self.session.post(url, json=payload)
        response.raise_for_status()
        json_response = response.json()
        success = json_response.get("success")
        if not success:
            raise ValueError(f"❌ Failed to create replace package for {package_name}, message: {json_response.get('message')}")
        
        return json_response.get("data", {})